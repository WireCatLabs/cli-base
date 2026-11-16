/**
 * Several OpenAPI 3 documents of one service → one, for a service that publishes a spec per object (HubSpot: 127).
 * Components that share a name and differ only in their text are merged; a real difference keeps both, the later one
 * under its source's prefix, with every reference inside that source rewritten. A path two sources share must hold
 * the same operations. What was merged, renamed and skipped is returned for the CLI's provenance.
 */
import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { isObject, OpenApiError } from "./openapi.js"

type Json = Record<string, unknown>

export interface SpecSource {
  /** Short and stable: `contacts`, `associations-4`. Its PascalCase form prefixes what this source renames. */
  name: string
  document: unknown
  /** Where it was downloaded from, for the provenance. */
  url?: string
}

export interface MergedSource {
  name: string
  url?: string
  /** Of the document as given, serialized as JSON. */
  sha256: string
  title?: string
  version?: string
  operations: number
}

export interface MergeReport {
  sources: MergedSource[]
  /** `schemas/Paging`: same shape in several sources, kept once. */
  merged: string[]
  /** `schemas/BatchResponse → AssociationsBatchResponse (associations)`: a real difference, renamed. */
  renamed: string[]
  /** `/crm/v3/associations/{a}/{b} (deals)`: a path an earlier source already brought with the same operations. */
  sharedPaths: string[]
}

export interface MergeOptions {
  title: string
  version: string
}

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"]
/** What two copies of one component may differ in and still be one. */
const TEXT = new Set(["description", "summary", "example", "examples", "title", "externalDocs"])

/** Under these keys a `description` or `title` is a field's name, not text. */
const NAMED = new Set(["properties", "patternProperties"])

const shape = (node: unknown, named = false): unknown =>
  Array.isArray(node)
    ? node.map((item) => shape(item))
    : isObject(node)
      ? Object.fromEntries(
          Object.entries(node).flatMap(([key, value]) =>
            !named && TEXT.has(key) ? [] : [[key, shape(value, !named && NAMED.has(key))]],
          ),
        )
      : node

const sameShape = (one: unknown, other: unknown) => isDeepStrictEqual(shape(one), shape(other))

/** A source's document-wide sign-in would be lost in the merged document, so its operations carry it. */
const withOwnSecurity = (document: Json): Json => {
  if (!Array.isArray(document.security) || !isObject(document.paths)) return document
  const { security, ...rest } = document
  const paths = Object.fromEntries(
    Object.entries(document.paths).map(([path, item]) => [
      path,
      isObject(item)
        ? Object.fromEntries(
            Object.entries(item).map(([method, operation]) => [
              method,
              METHODS.includes(method) && isObject(operation) && operation.security === undefined
                ? { ...operation, security }
                : operation,
            ]),
          )
        : item,
    ]),
  )
  return { ...rest, paths }
}

const pascal = (name: string) =>
  name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join("")

const decode = (segment: string) => segment.replaceAll("~1", "/").replaceAll("~0", "~")
const encode = (segment: string) => segment.replaceAll("~", "~0").replaceAll("/", "~1")
const COMPONENT_REF = /^#\/components\/([^/]+)\/(.+)$/

const rewriteRefs = (node: unknown, renames: ReadonlyMap<string, string>): unknown => {
  if (Array.isArray(node)) return node.map((item) => rewriteRefs(item, renames))
  if (!isObject(node)) return node
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => {
      if (key !== "$ref" || typeof value !== "string") return [key, rewriteRefs(value, renames)]
      const found = COMPONENT_REF.exec(value)
      const renamed = found && renames.get(`${found[1]}/${decode(found[2] ?? "")}`)
      return [key, renamed ? `#/components/${found[1]}/${encode(renamed)}` : value]
    }),
  )
}

const operationsOf = (item: unknown): string =>
  isObject(item)
    ? METHODS.filter((method) => isObject(item[method]))
        .map((method) => `${method}:${String((item[method] as Json).operationId)}`)
        .join(",")
    : ""

/** Throws `OpenApiError` with every conflict at once: a path, an operation id or a sign-in two sources disagree on. */
export const mergeOpenApi = (
  sources: readonly SpecSource[],
  options: MergeOptions,
): { document: Json; report: MergeReport } => {
  const problems: string[] = []
  const components: Record<string, Json> = {}
  const paths: Json = {}
  const servers = new Map<string, unknown>()
  const tags = new Map<string, unknown>()
  const operationIds = new Map<string, string>()
  const report: MergeReport = { sources: [], merged: [], renamed: [], sharedPaths: [] }
  const versions = new Set<string>()
  const names = new Set<string>()

  for (const { name, document, url } of sources) {
    if (!isObject(document) || typeof document.openapi !== "string" || !document.openapi.startsWith("3.")) {
      problems.push(`${name}: not an OpenAPI 3 document`)
      continue
    }
    if (names.has(name)) problems.push(`${name}: two sources share this name`)
    names.add(name)
    versions.add(document.openapi)
    const info = isObject(document.info) ? document.info : {}
    const own = isObject(document.components) ? document.components : {}

    // A component that only refers to a renamed one differs too, so renaming repeats until nothing more changes.
    const renames = new Map<string, string>()
    for (let grown = true; grown; ) {
      grown = false
      const current = rewriteRefs(own, renames) as Json
      for (const [section, entries] of Object.entries(current)) {
        if (section === "securitySchemes" || !isObject(entries)) continue
        for (const [key, value] of Object.entries(entries)) {
          const have = components[section]?.[key]
          if (have === undefined || renames.has(`${section}/${key}`) || sameShape(have, value)) continue
          renames.set(`${section}/${key}`, `${pascal(name)}${key}`)
          grown = true
        }
      }
    }
    const rewritten = rewriteRefs(withOwnSecurity(document), renames) as Json
    const rewrittenComponents = isObject(rewritten.components) ? rewritten.components : {}

    for (const [section, entries] of Object.entries(rewrittenComponents)) {
      if (!isObject(entries)) continue
      components[section] ??= {}
      const into = components[section]
      for (const [key, value] of Object.entries(entries)) {
        if (section === "securitySchemes") {
          const have = into[key]
          if (have === undefined) into[key] = structuredClone(value)
          else if (isObject(have) && isObject(value) && have.type === "oauth2" && value.type === "oauth2") {
            // Each spec lists only its own object's scopes; the service's sign-in is one.
            have.flows ??= {}
            const flows = have.flows as Json
            for (const [flow, body] of Object.entries(isObject(value.flows) ? value.flows : {})) {
              if (!isObject(body)) continue
              flows[flow] ??= structuredClone(body)
              const target = flows[flow] as Json
              target.scopes = {
                ...(isObject(target.scopes) ? target.scopes : {}),
                ...(isObject(body.scopes) ? body.scopes : {}),
              }
            }
          } else if (!sameShape(have, value))
            problems.push(`${name}: security scheme "${key}" differs from an earlier source's`)
          continue
        }
        const target = renames.get(`${section}/${key}`) ?? key
        if (target !== key) {
          if (into[target] !== undefined) problems.push(`${name}: ${section}/${target}, its renamed ${key}, is taken`)
          report.renamed.push(`${section}/${key} → ${target} (${name})`)
          into[target] = value
        } else if (into[key] === undefined) into[key] = value
        else if (!report.merged.includes(`${section}/${key}`)) report.merged.push(`${section}/${key}`)
      }
    }

    let operations = 0
    for (const [path, item] of Object.entries(isObject(rewritten.paths) ? rewritten.paths : {})) {
      if (paths[path] !== undefined) {
        if (operationsOf(paths[path]) === operationsOf(item)) report.sharedPaths.push(`${path} (${name})`)
        else problems.push(`${name}: ${path} has other operations than an earlier source's`)
        continue
      }
      paths[path] = item
      for (const method of METHODS) {
        const operation = isObject(item) ? item[method] : undefined
        if (!isObject(operation)) continue
        operations++
        if (typeof operation.operationId !== "string") continue
        const earlier = operationIds.get(operation.operationId)
        if (earlier) problems.push(`${name}: operation id "${operation.operationId}" is also ${earlier}'s`)
        else operationIds.set(operation.operationId, name)
      }
    }
    for (const server of Array.isArray(rewritten.servers) ? rewritten.servers : [])
      if (isObject(server) && typeof server.url === "string" && !servers.has(server.url))
        servers.set(server.url, server)
    for (const tag of Array.isArray(rewritten.tags) ? rewritten.tags : [])
      if (isObject(tag) && typeof tag.name === "string" && !tags.has(tag.name)) tags.set(tag.name, tag)

    report.sources.push({
      name,
      ...(url ? { url } : {}),
      sha256: createHash("sha256").update(JSON.stringify(document)).digest("hex"),
      ...(typeof info.title === "string" ? { title: info.title } : {}),
      ...(typeof info.version === "string" ? { version: info.version } : {}),
      operations,
    })
  }
  // 3.0 reads `nullable` and 3.1 `type: [T, "null"]`; one merged document would misstate one of them.
  if (new Set([...versions].map((version) => version.slice(0, 3))).size > 1)
    problems.push(`the sources mix OpenAPI versions ${[...versions].sort().join(", ")}; convert them to one first`)
  if (problems.length > 0) throw new OpenApiError(problems)

  const document: Json = {
    openapi: [...versions].sort().at(-1) ?? "3.0.3",
    info: { title: options.title, version: options.version },
    ...(servers.size > 0 ? { servers: [...servers.values()] } : {}),
    ...(tags.size > 0 ? { tags: [...tags.values()] } : {}),
    paths,
    components,
  }
  return { document, report }
}
