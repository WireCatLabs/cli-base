import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, extname, join, posix } from "node:path"
import type {
  ApiModel,
  ApiOperation,
  ApiSchema,
  CodeGenerator,
  GeneratedArtifact,
  OperationPermission,
  Override,
  PageParameter,
  Pagination,
  SchemaNode,
  SecurityRequirement,
  SecurityScheme,
} from "./model.js"
import { bindingLabel, identifier, kebab } from "./names.js"
import { answerPaths, detectPagination, requestParameters } from "./pagination.js"
import { signInRequirements } from "./sign-in.js"

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
    .map((segment) =>
      names.segments && Object.hasOwn(names.segments, segment) ? names.segments[segment] : kebab(segment),
    )
    .filter(Boolean)
  const onItem = isParameter(parts.at(-1) ?? "")
  // A POST to a path that also lists or holds items creates one; to any other path it is the action the path names.
  const collection = all.some(
    (other) =>
      other.binding.kind === "http" &&
      ((other.binding.method === "GET" && other.binding.path === path) ||
        (other.binding.path.startsWith(`${path}/{`) && !other.binding.path.slice(path.length + 1).includes("/"))),
  )
  // A PUT on the collection beside a PUT on its item is the "create or update by a unique value" (Attio's assert).
  const itemPut = all.some(
    (other) =>
      other.binding.kind === "http" &&
      other.binding.method === "PUT" &&
      other.binding.path.startsWith(`${path}/{`) &&
      !other.binding.path.slice(path.length + 1).includes("/"),
  )
  const verb = {
    GET: onItem || parts.at(-1) === "me" ? "get" : "list",
    HEAD: "head",
    DELETE: "delete",
    PATCH: "update",
    PUT: onItem ? "replace" : collection ? (itemPut ? "upsert" : "replace") : "",
    POST: onItem ? "update" : collection ? "create" : "",
  }[method]
  return [...words, verb].filter(Boolean).join("-")
}

export const applyNames = (model: ApiModel, names: CommandNames): ApiModel => {
  const known = new Set(model.operations.map((operation) => operation.id))
  const segments = new Set(
    model.operations.flatMap((operation) =>
      operation.binding.kind === "http" ? operation.binding.path.split("/") : [],
    ),
  )
  const problems = [
    ...Object.keys(names.commands ?? {}).flatMap((id) =>
      known.has(id) ? [] : [`names: "${id}" matches no operation`],
    ),
    ...Object.keys(names.segments ?? {}).flatMap((segment) =>
      segments.has(segment) ? [] : [`names: segment "${segment}" is in no path`],
    ),
  ]
  const operations = model.operations.map((operation) => {
    const own = names.commands && Object.hasOwn(names.commands, operation.id) ? names.commands[operation.id] : undefined
    const command = own ?? (names.fromPath ? commandFromPath(operation, model.operations, names) : undefined)
    if (command === undefined) return operation
    // An empty or malformed name would otherwise fall back to the id, the name `names` exists to avoid.
    if (!COMMAND.test(command)) {
      const where = operation.binding.kind === "http" ? ` (${operation.binding.method} ${operation.binding.path})` : ""
      problems.push(
        `names: operation "${operation.id}"${where} gets "${command}", not a kebab-case command; map it in commands`,
      )
    }
    return { ...operation, command }
  })
  if (problems.length > 0) throw new CodegenError(problems)
  return { ...model, operations }
}

/** Each read's pagination, detected unless an override set it, or said with `null` that the read does not page. */
export const applyPagination = (
  model: ApiModel,
  overrides: Readonly<Record<string, { pagination?: Pagination | null; reason: string }>>,
  detect: boolean,
): ApiModel => {
  const schemas = new Map(model.schemas.map((schema) => [schema.id, schema]))
  const problems: string[] = []
  const operations = model.operations.map((operation) => {
    const override = overrides[operation.id]
    if (override?.pagination === null) return operation
    if (override?.pagination) {
      const at = `override "${operation.id}": pagination`
      if (operation.effect !== "read") problems.push(`${at} on an operation that is not a read`)
      const request = requestParameters(operation, schemas)
      const answer = answerPaths(operation, schemas)
      const { style: _, start: __, pagesHeader: ___, ...fields } = override.pagination as Record<string, unknown>
      for (const [field, value] of Object.entries(fields)) {
        // `""`: the answer itself is the list.
        if (value === "") continue
        if (typeof value === "string") {
          // An answer without a schema has nothing to check the path against.
          if (answer.size > 0 && !answer.has(value))
            problems.push(`${at} reads ${field} from "${value}", which the answer lacks`)
          continue
        }
        const parameter = value as PageParameter | null
        if (!parameter || typeof parameter !== "object" || typeof parameter.name !== "string")
          problems.push(`${at}: ${field} must name a parameter`)
        else if (!request.some((one) => one.in === parameter.in && one.name === parameter.name))
          problems.push(`${at} names ${parameter.in} "${parameter.name}", which the operation does not take`)
      }
      return { ...operation, pagination: override.pagination, paginationSource: `override: ${override.reason}` }
    }
    const found = detect ? detectPagination(operation, schemas) : undefined
    return found ? { ...operation, pagination: found, paginationSource: "detected" } : operation
  })
  if (problems.length > 0) throw new CodegenError(problems)
  return { ...model, operations }
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
  /**
   * A field whose value is the change, not a flag: WordPress publishes by `status: "publish"`. Each gives
   * `<group>.<key>` to every write or delete whose body field or query parameter `field` lists one of `values` in its
   * `enum`, so a field of the same name that means something else (a comment's `status`) gets no key, nor does a read
   * that filters by the value. Where the field's default is one of `values` (a WordPress template), leaving it out
   * publishes too, and the key always applies.
   *
   * `also` names fields that make the same change through another door: WordPress publishes a scheduled post whose
   * `date` moves into the past. Setting one applies the key too, unless the call itself sets `field` to a value
   * outside `values` (a draft's new date); a call that leaves `field` out cannot say what is stored, so it needs the key.
   */
  valueKeys?: readonly { key: string; field: string; values: readonly string[]; also?: readonly string[] }[]
  /**
   * Flags that make a delete permanent instead of a move to the trash: WordPress's `force`. A delete that takes one
   * also needs `<group>.delete.force` when the flag is `true`; without it the trash is `<group>.delete` alone.
   */
  forceFlags?: readonly string[]
}

/** The top-level properties a body may carry, through references, inheritance, unions and subtypes. */
const bodyFields = (
  node: SchemaNode,
  schemas: ReadonlyMap<string, ApiSchema>,
  seen = new Set<string>(),
): [string, SchemaNode][] => {
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
      return Object.entries(node.properties)
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
  const fields = new Map(
    model.operations.map((operation) => [
      operation.id,
      new Map(operation.requestBody?.schema ? bodyFields(operation.requestBody.schema, schemas) : []),
    ]),
  )
  const fieldsOf = (operation: ApiOperation) => fields.get(operation.id) ?? new Map<string, SchemaNode>()
  /** The enums and defaults of a field, through references and every alternative of a union. */
  const valuesIn = (
    node: SchemaNode | undefined,
    seen = new Set<string>(),
  ): { enums: unknown[]; defaults: unknown[] } => {
    if (!node) return { enums: [], defaults: [] }
    const own = {
      enums: "enum" in node && node.enum ? [...node.enum] : [],
      defaults: node.default === undefined ? [] : [node.default],
    }
    const inner =
      node.type === "ref" && !seen.has(node.ref)
        ? [valuesIn(schemas.get(node.ref)?.schema, new Set([...seen, node.ref]))]
        : node.type === "union" || node.type === "allOf"
          ? node.of.map((member) => valuesIn(member, seen))
          : []
    return {
      enums: [...own.enums, ...inner.flatMap((one) => one.enums)],
      defaults: [...own.defaults, ...inner.flatMap((one) => one.defaults)],
    }
  }
  const valuesOf = (operation: ApiOperation, name: string) => {
    const nodes = [
      fieldsOf(operation).get(name),
      operation.parameters.find((parameter) => parameter.in === "query" && parameter.name === name)?.schema,
    ].map((node) => valuesIn(node))
    return { enums: nodes.flatMap((one) => one.enums), defaults: nodes.flatMap((one) => one.defaults) }
  }
  const valueKeys = rule.valueKeys ?? []
  // A field whose default is one of the values publishes when the call leaves it out: the key then always applies.
  const takes = (operation: ApiOperation, names: readonly string[]) => ({
    body: names.filter((name) => fieldsOf(operation).has(name)),
    query: names.filter((name) =>
      operation.parameters.some((parameter) => parameter.in === "query" && parameter.name === name),
    ),
  })
  const flagged = ({ body, query }: { body: string[]; query: string[] }) => ({
    ...(body.length > 0 ? { body } : {}),
    ...(query.length > 0 ? { query } : {}),
  })
  const valued = (operation: ApiOperation): OperationPermission[] =>
    operation.effect === "read"
      ? []
      : valueKeys.flatMap(({ key, field, values, also = [] }) => {
          const { enums, defaults } = valuesOf(operation, field)
          const named = values.filter((value) => enums.includes(value))
          if (named.length === 0) return []
          if (defaults.some((value) => values.includes(value as string))) return [{ key }]
          const others = takes(operation, also)
          const unless = [...new Set(enums.filter((value): value is string => typeof value === "string"))].filter(
            (value) => !values.includes(value),
          )
          return [
            {
              key,
              values: { [field]: named },
              ...flagged(others),
              ...(others.body.length + others.query.length > 0 && unless.length > 0
                ? { unless: { [field]: unless } }
                : {}),
            },
          ]
        })
  const idle = valueKeys.filter(
    ({ key }) => !model.operations.some((operation) => valued(operation).some((one) => one.key === key)),
  )
  if (idle.length > 0)
    throw new CodegenError(
      idle.map(({ field, values }) => `valueKeys: no write lists ${values.join(" or ")} in the enum of "${field}"`),
    )
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
  const forceFlags = rule.forceFlags ?? []
  const forcing = (operation: ApiOperation) => takes(operation, forceFlags)
  const idleForce = forceFlags.filter(
    (flag) =>
      !model.operations.some((operation) => {
        if (operation.effect !== "destructive") return false
        const { body, query } = forcing(operation)
        return body.includes(flag) || query.includes(flag)
      }),
  )
  if (idleForce.length > 0)
    throw new CodegenError(idleForce.map((flag) => `forceFlags: "${flag}" is in no delete's request body or query`))
  return {
    ...model,
    operations: model.operations.map((operation) => {
      const group = typeof rule.group === "string" ? rule.group : rule.group(operation)
      const permissions: OperationPermission[] = []
      if (rule.shares?.includes(operation.id)) permissions.push({ key: `${group}.share` })
      if (operation.effect === "destructive") {
        permissions.push({ key: `${group}.delete` })
        const force = forcing(operation)
        if (force.body.length + force.query.length > 0)
          permissions.push({ key: `${group}.delete.force`, ...flagged(force) })
      } else {
        const body = flags.filter((flag) => fieldsOf(operation).has(flag))
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
      for (const permission of valued(operation)) permissions.push({ ...permission, key: `${group}.${permission.key}` })
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
    // `[]` is replaced too: `auth` says the source's sign-in is wrong, and a key sent to a public call is ignored while
    // a key left off a private one always fails.
    operations: model.operations.map(({ security, ...operation }) =>
      signInRequirements({ security }, undefined) &&
      security?.every((requirement) => Object.keys(requirement).every((name) => names.has(name)))
        ? { ...operation, security }
        : operation,
    ),
  }
}

const bindingKey = (operation: ApiOperation): string =>
  operation.binding.kind === "rpc" ? `rpc ${operation.binding.name}` : bindingLabel(operation.binding)

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
  const commandOf = (operation: ApiOperation) => operation.command ?? kebab(operation.id)
  for (const command of duplicates(model.operations.map(commandOf))) {
    const ids = model.operations
      .filter((operation) => commandOf(operation) === command)
      .map((operation) => operation.id)
    problems.push(`two operations both become the command "${command}": ${ids.join(", ")}`)
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
  /** Detect how each read pages; an override's `pagination` wins either way. */
  pagination?: boolean
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
  const paged = applyPagination(overridden, options.overrides ?? {}, options.pagination === true)
  const named = options.names ? applyNames(paged, options.names) : paged
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
  /**
   * Folders, relative to `root`, that hold only generated files: a file there that was not generated this time (a
   * group that left the spec) is stale too, and removed when writing.
   */
  owns?: readonly string[]
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
  const generated = new Set(artifacts.map((artifact) => posix.normalize(artifact.path)))
  for (const owned of options.owns ?? []) {
    const folder = posix.normalize(owned).replace(/\/+$/, "")
    if (!existsSync(join(options.root, folder))) continue
    for (const entry of readdirSync(join(options.root, folder), { withFileTypes: true })) {
      const path = posix.join(folder, entry.name)
      if (!entry.isFile() || generated.has(path)) continue
      stale.push(path)
      if (!options.check) rmSync(join(options.root, path))
    }
  }
  return stale
}
