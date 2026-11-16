import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, extname, join } from "node:path"
import type {
  ApiModel,
  ApiOperation,
  ApiSchema,
  CodeGenerator,
  GeneratedArtifact,
  OperationPermission,
  Override,
  SchemaNode,
  SecurityRequirement,
  SecurityScheme,
} from "./model.js"
import { identifier, kebab } from "./names.js"

export class CodegenError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`generation stopped:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`)
    this.name = "CodegenError"
  }
}

/**
 * A POST to these paths only reads, as HubSpot's and Notion's search and query do. Opt-in through `readingPosts`: a
 * wrong guess turns a write into a read (a `/database/query` that runs any SQL).
 */
const READING_POST = /[/:](search|query)$/i
export const READING_POST_REASON = "a POST to a …/search or …/query path only reads (readingPosts rule)"

const applyReadingPosts = (model: ApiModel): ApiModel => ({
  ...model,
  operations: model.operations.map((operation) =>
    operation.binding.kind === "http" &&
    operation.binding.method === "POST" &&
    READING_POST.test(operation.binding.path)
      ? { ...operation, effect: "read", effectReason: READING_POST_REASON }
      : operation,
  ),
})

/**
 * Command names for a source whose operation ids make poor ones: HubSpot's `get-/crm/v3/objects/contacts_getPage`.
 * `commands` wins; with `fromPath` the rest are named from the path and the method; otherwise from the id.
 */
export interface CommandNames {
  /** Operation id → command, kebab case: `{ "get-/crm/v3/objects/contacts_getPage": "contacts-list" }`. */
  commands?: Readonly<Record<string, string>>
  fromPath?: boolean
  /** A path segment → its word in a command; `""` leaves it out: `{ "0-3": "deals", crm: "", objects: "" }`. */
  segments?: Readonly<Record<string, string>>
}

const COMMAND = /^[a-z0-9]+(-[a-z0-9]+)*$/
const VERSION = /^(v\d+(\.\d+)*|\d{4}-\d{2}(-[a-z]+)?)$/i
const isParameter = (segment: string) => segment.startsWith("{")

/** `contacts-list`, `contacts-get`, `contacts-create`, `contacts-batch-archive`: segments, then what the method does. */
const commandFromPath = (operation: ApiOperation, all: readonly ApiOperation[], names: CommandNames): string => {
  if (operation.binding.kind !== "http") return kebab(operation.id)
  const { method, path } = operation.binding
  const parts = path.split("/").filter(Boolean)
  const words = parts
    .filter((segment) => !isParameter(segment) && !VERSION.test(segment))
    .map((segment) => names.segments?.[segment] ?? kebab(segment))
    .filter(Boolean)
  const onItem = isParameter(parts.at(-1) ?? "")
  // A POST to a path that also lists or holds items creates one; to any other path it is the action the path names.
  const collection = all.some(
    (other) =>
      other.binding.kind === "http" &&
      ((other.binding.method === "GET" && other.binding.path === path) ||
        (other.binding.path.startsWith(`${path}/{`) && !other.binding.path.slice(path.length + 1).includes("/"))),
  )
  const verb = {
    GET: onItem ? "get" : "list",
    HEAD: "head",
    DELETE: "delete",
    PATCH: "update",
    PUT: onItem || collection ? "replace" : "",
    POST: onItem || collection ? "create" : "",
  }[method]
  return [...words, verb].filter(Boolean).join("-")
}

export const applyNames = (model: ApiModel, names: CommandNames): ApiModel => {
  const known = new Set(model.operations.map((operation) => operation.id))
  const problems = Object.entries(names.commands ?? {}).flatMap(([id, command]) => [
    ...(known.has(id) ? [] : [`names: "${id}" matches no operation`]),
    ...(COMMAND.test(command) ? [] : [`names: "${command}" is not a kebab-case command`]),
  ])
  if (problems.length > 0) throw new CodegenError(problems)
  return {
    ...model,
    operations: model.operations.map((operation) => {
      const command =
        names.commands?.[operation.id] ??
        (names.fromPath ? commandFromPath(operation, model.operations, names) : undefined)
      return command ? { ...operation, command } : operation
    }),
  }
}

export const applyOverrides = (model: ApiModel, overrides: Readonly<Record<string, Override>>): ApiModel => {
  const known = new Set(model.operations.map((operation) => operation.id))
  const stale = Object.keys(overrides).filter((id) => !known.has(id))
  if (stale.length > 0) {
    // A correction that matches nothing any more has silently stopped being applied.
    throw new CodegenError(stale.map((id) => `override "${id}" matches no operation — stale, or the id changed`))
  }
  return {
    ...model,
    operations: model.operations.map((operation) => {
      const override = overrides[operation.id]
      return override?.effect
        ? { ...operation, effect: override.effect, effectReason: `override: ${override.reason}` }
        : operation
    }),
  }
}

/**
 * Which calls the CLI's own permission keys guard, so denying `files.delete` also holds over the raw `api` group:
 * `<group>.delete` for every destructive operation and for every flag in `deletingFlags` an operation takes (cli-core
 * checks the key when the flag is `true`); `<group>.share` for the operations in `shares`.
 */
export interface PermissionRule {
  /** `files`, or one per operation (a tag, a spec's prefix). */
  group: string | ((operation: ApiOperation) => string)
  /**
   * Top-level body fields and query parameters that delete or overwrite when `true`: `archived`, `in_trash` (Notion),
   * `permanently`, `overwrite` (Yandex Disk).
   */
  deletingFlags?: readonly string[]
  /** Operation ids that make something public, as a share link does: neither a plain write nor a delete. */
  shares?: readonly string[]
}

/** The top-level property names a body may carry, through references, inheritance, unions and subtypes. */
const bodyFields = (node: SchemaNode, schemas: ReadonlyMap<string, ApiSchema>, seen = new Set<string>()): string[] => {
  switch (node.type) {
    case "ref": {
      const target = schemas.get(node.ref)
      if (!target || seen.has(node.ref)) return []
      const inner = new Set([...seen, node.ref])
      const subtypes = Object.values(target.discriminator?.mapping ?? {}).flatMap((id) =>
        bodyFields({ type: "ref", ref: id }, schemas, inner),
      )
      return [...bodyFields(target.schema, schemas, inner), ...subtypes]
    }
    case "object":
      return Object.keys(node.properties)
    case "union":
    case "allOf":
      return node.of.flatMap((member) => bodyFields(member, schemas, seen))
    default:
      return []
  }
}

export const applyPermissionRule = (model: ApiModel, rule: PermissionRule): ApiModel => {
  const known = new Set(model.operations.map((operation) => operation.id))
  const stale = (rule.shares ?? []).filter((id) => !known.has(id))
  if (stale.length > 0) throw new CodegenError(stale.map((id) => `shares: "${id}" matches no operation`))
  const flags = rule.deletingFlags ?? []
  const schemas = new Map(model.schemas.map((schema) => [schema.id, schema]))
  const fieldsOf = (operation: ApiOperation) =>
    new Set(operation.requestBody?.schema ? bodyFields(operation.requestBody.schema, schemas) : [])
  const unused = flags.filter(
    (flag) =>
      !model.operations.some(
        (operation) =>
          fieldsOf(operation).has(flag) ||
          operation.parameters.some((parameter) => parameter.in === "query" && parameter.name === flag),
      ),
  )
  if (unused.length > 0)
    throw new CodegenError(unused.map((flag) => `deletingFlags: "${flag}" is in no request body or query`))
  return {
    ...model,
    operations: model.operations.map((operation) => {
      const group = typeof rule.group === "string" ? rule.group : rule.group(operation)
      const permissions: OperationPermission[] = []
      if (rule.shares?.includes(operation.id)) permissions.push({ key: `${group}.share` })
      if (operation.effect === "destructive") permissions.push({ key: `${group}.delete` })
      else {
        const fields = fieldsOf(operation)
        const body = flags.filter((flag) => fields.has(flag))
        const query = flags.filter((flag) =>
          operation.parameters.some((parameter) => parameter.in === "query" && parameter.name === flag),
        )
        if (body.length > 0 || query.length > 0)
          permissions.push({
            key: `${group}.delete`,
            ...(body.length > 0 ? { body } : {}),
            ...(query.length > 0 ? { query } : {}),
          })
      }
      return permissions.length > 0 ? { ...operation, permissions } : operation
    }),
  }
}

/**
 * Sign-in the source does not describe, or describes wrongly: Yandex Disk's Swagger 1.2 has no scheme, and its header
 * is `Authorization: OAuth <token>`, which `{ type: "http", scheme: "OAuth" }` says. Replaces the source's own.
 */
export interface AuthOverride {
  securitySchemes: Readonly<Record<string, SecurityScheme>>
  security: readonly SecurityRequirement[]
  reason: string
}

const applyAuth = (model: ApiModel, auth: AuthOverride): ApiModel => {
  const names = new Set(Object.keys(auth.securitySchemes))
  const unknown = [...new Set(auth.security.flatMap(Object.keys))].filter((name) => !names.has(name))
  if (unknown.length > 0)
    throw new CodegenError(unknown.map((name) => `auth: security names "${name}", which securitySchemes lacks`))
  return {
    ...model,
    securitySchemes: auth.securitySchemes,
    security: auth.security,
    securityReason: auth.reason,
    // The source's per-operation requirements name its own schemes, which this replaces.
    operations: model.operations.map(({ security: _, ...operation }) => operation),
  }
}

const bindingKey = (operation: ApiOperation): string =>
  operation.binding.kind === "http"
    ? `${operation.binding.method} ${operation.binding.path}`
    : `rpc ${operation.binding.name}`

const duplicates = (values: readonly string[]): string[] =>
  [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort()

const refsIn = (node: SchemaNode, found: string[] = []): string[] => {
  switch (node.type) {
    case "ref":
      found.push(node.ref)
      break
    case "array":
      refsIn(node.items, found)
      break
    case "object":
      for (const property of Object.values(node.properties)) refsIn(property, found)
      if (node.additionalProperties) refsIn(node.additionalProperties, found)
      break
    case "union":
    case "allOf":
      for (const member of node.of) refsIn(member, found)
      break
  }
  return found
}

const mergedRefs = (node: SchemaNode): string[] => {
  if (node.type === "ref") return [node.ref]
  if (node.type === "allOf") return node.of.flatMap(mergedRefs)
  return []
}

/** Only the references an allOf merge follows: a property or an array item may point back legitimately. */
const mergeCycles = (model: ApiModel): string[] => {
  const byId = new Map(model.schemas.map((schema) => [schema.id, schema.schema]))
  const done = new Set<string>()
  const problems: string[] = []
  const visit = (id: string, path: string[]): void => {
    const at = path.indexOf(id)
    if (at >= 0) {
      problems.push(`schema "${id}" includes itself through allOf: ${[...path.slice(at), id].join(" → ")}`)
      return
    }
    const node = byId.get(id)
    if (done.has(id) || !node) return
    for (const ref of mergedRefs(node)) visit(ref, [...path, id])
    done.add(id)
  }
  for (const schema of model.schemas) visit(schema.id, [])
  return problems
}

/** Everything that would otherwise make an operation vanish or turn into a guess. */
export const validateModel = (model: ApiModel): void => {
  const problems: string[] = []
  for (const id of duplicates(model.operations.map((operation) => operation.id))) {
    problems.push(`two operations share the id "${id}"`)
  }
  for (const key of duplicates(model.operations.map(bindingKey))) problems.push(`two operations are both ${key}`)
  for (const id of duplicates(model.schemas.map((schema) => schema.id))) {
    problems.push(`two schemas share the id "${id}"`)
  }
  for (const command of duplicates(model.operations.map((operation) => operation.command ?? kebab(operation.id)))) {
    problems.push(`two operations both become the command "${command}"`)
  }
  for (const name of duplicates(model.schemas.map((schema) => identifier(schema.id)))) {
    problems.push(`two schemas both become the name "${name}"`)
  }
  for (const operation of model.operations) {
    for (const name of duplicates(operation.parameters.map((parameter) => parameter.name))) {
      problems.push(`operation "${operation.id}" has two parameters named "${name}"`)
    }
  }
  for (const operation of model.operations) {
    if (!operation.effect) problems.push(`operation "${operation.id}" is not classified as read, write or destructive`)
  }

  const validUnions = (node: SchemaNode, where: string): void => {
    if ((node.type === "boolean" || node.type === "string" || node.type === "integer") && node.enum?.length === 0)
      problems.push(`${where}: an enum has no values`)
    if (node.type === "union" || node.type === "allOf") {
      if (node.type === "union" && node.of.length === 0) problems.push(`${where}: a union has no members`)
      for (const member of node.of) validUnions(member, where)
    } else if (node.type === "array") validUnions(node.items, `${where}[]`)
    else if (node.type === "object") {
      for (const [name, property] of Object.entries(node.properties)) validUnions(property, `${where}.${name}`)
      if (node.additionalProperties) validUnions(node.additionalProperties, where)
    }
  }
  for (const schema of model.schemas) validUnions(schema.schema, `schema "${schema.id}"`)
  for (const operation of model.operations) {
    for (const parameter of operation.parameters) validUnions(parameter.schema, `operation "${operation.id}"`)
    if (operation.requestBody?.schema) validUnions(operation.requestBody.schema, `operation "${operation.id}" request`)
    if (operation.response?.schema) validUnions(operation.response.schema, `operation "${operation.id}" response`)
  }
  const schemaIds = new Set(model.schemas.map((schema) => schema.id))
  const unresolved = (where: string, node: SchemaNode | undefined) => {
    if (!node) return
    for (const ref of refsIn(node)) if (!schemaIds.has(ref)) problems.push(`${where} refers to unknown schema "${ref}"`)
  }
  for (const schema of model.schemas) {
    unresolved(`schema "${schema.id}"`, schema.schema)
    for (const [value, target] of Object.entries(schema.discriminator?.mapping ?? {})) {
      if (!schemaIds.has(target)) problems.push(`schema "${schema.id}" maps "${value}" to unknown schema "${target}"`)
    }
  }
  for (const operation of model.operations) {
    for (const parameter of operation.parameters) unresolved(`operation "${operation.id}"`, parameter.schema)
    unresolved(`operation "${operation.id}" request`, operation.requestBody?.schema)
    unresolved(`operation "${operation.id}" response`, operation.response?.schema)
  }
  const schemes = new Set(Object.keys(model.securitySchemes ?? {}))
  const named = [model.security ?? [], ...model.operations.map((operation) => operation.security ?? [])]
  for (const name of new Set(named.flat().flatMap(Object.keys)))
    if (!schemes.has(name)) problems.push(`security names "${name}", which securitySchemes lacks`)
  problems.push(...mergeCycles(model))
  if (problems.length > 0) throw new CodegenError(problems)
}

export interface GenerateOptions {
  overrides?: Readonly<Record<string, Override>>
  /** Treat a POST to a `…/search` or `…/query` path as a read; an override still wins. */
  readingPosts?: boolean
  names?: CommandNames
  permissions?: PermissionRule
  auth?: AuthOverride
  /** Lines under "GENERATED. DO NOT EDIT." — the source and the command. Nothing that changes by itself. */
  banner: readonly string[]
}

const commentFor = (path: string, lines: readonly string[]): string => {
  if (extname(path) === ".md") return `<!--\n${lines.join("\n")}\n-->\n\n`
  return `${lines.map((line) => `// ${line}`).join("\n")}\n\n`
}

export const generate = (
  model: ApiModel,
  generators: readonly CodeGenerator[],
  options: GenerateOptions,
): GeneratedArtifact[] => {
  const overridden = applyOverrides(options.readingPosts ? applyReadingPosts(model) : model, options.overrides ?? {})
  const named = options.names ? applyNames(overridden, options.names) : overridden
  const authed = options.auth ? applyAuth(named, options.auth) : named
  // After the overrides: an operation an override calls destructive is a delete too.
  const prepared = options.permissions ? applyPermissionRule(authed, options.permissions) : authed
  validateModel(prepared)
  const artifacts = generators.flatMap((generator) => generator(prepared))
  const clashing = duplicates(artifacts.map((artifact) => artifact.path))
  if (clashing.length > 0) throw new CodegenError(clashing.map((path) => `two generators both write ${path}`))
  const banner = ["GENERATED. DO NOT EDIT.", ...options.banner]
  return artifacts.map((artifact) => ({ ...artifact, content: commentFor(artifact.path, banner) + artifact.content }))
}

export interface WriteOptions {
  root: string
  /** Compare only: report what is out of date and write nothing. */
  check?: boolean
  /** The consumer's formatter, so a check compares what would actually be committed. */
  format?: (path: string, content: string) => string
}

/** Paths whose committed content differs from what was generated — written, or with `check`, only reported. */
export const writeArtifacts = (artifacts: readonly GeneratedArtifact[], options: WriteOptions): string[] => {
  const stale: string[] = []
  for (const artifact of artifacts) {
    const target = join(options.root, artifact.path)
    const content = options.format ? options.format(artifact.path, artifact.content) : artifact.content
    const current = existsSync(target) ? readFileSync(target, "utf8") : undefined
    if (current === content) continue
    stale.push(artifact.path)
    if (options.check) continue
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  return stale
}
