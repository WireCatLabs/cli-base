/**
 * Corrections to a source document before it is adapted, each with its reason, in place of a hand-written
 * `scripts/<service>-spec.ts` per CLI. The returned `applied` list belongs in the CLI's provenance or coverage page.
 */
import { isObject, OpenApiError } from "./openapi.js"

type Json = Record<string, unknown>

export interface SpecPatch {
  /**
   * A JSON pointer: `/components/schemas/Void`, `/paths/~1x/get/parameters/0/name`. Its parent must exist; the value is
   * set or replaced, and `-` appends to an array.
   */
  pointer: string
  value: unknown
  reason: string
}

export interface PatchSpecOptions {
  patches?: readonly SpecPatch[]
  /**
   * The reason for giving every schema the document references but does not define an "anything" stub, as HubSpot's
   * associations v4 needs for `Void`.
   */
  stubMissingSchemas?: string
}

export interface PatchedSpec {
  document: Json
  applied: { pointer: string; reason: string }[]
}

const decode = (segment: string) => segment.replaceAll("~1", "/").replaceAll("~0", "~")
const encode = (segment: string) => segment.replaceAll("~", "~0").replaceAll("/", "~1")
const SCHEMA_REF = "#/components/schemas/"
// A pointer through these would change every object in the process, not the document.
const UNSAFE = new Set(["__proto__", "constructor", "prototype"])

const child = (node: unknown, segment: string): unknown => {
  if (Array.isArray(node)) return /^\d+$/.test(segment) ? node[Number(segment)] : undefined
  return isObject(node) && Object.hasOwn(node, segment) ? node[segment] : undefined
}

const refs = (node: unknown, found: Set<string>): Set<string> => {
  if (Array.isArray(node)) for (const item of node) refs(item, found)
  else if (isObject(node)) {
    if (typeof node.$ref === "string" && node.$ref.startsWith(SCHEMA_REF))
      found.add(decode(decodeURIComponent(node.$ref.slice(SCHEMA_REF.length))))
    for (const value of Object.values(node)) refs(value, found)
  }
  return found
}

/** Returns a patched copy; the caller's document is left as it is. Throws `OpenApiError` naming every patch that misses. */
export const patchSpec = (document: unknown, options: PatchSpecOptions): PatchedSpec => {
  if (!isObject(document)) throw new OpenApiError(["not an OpenAPI document"])
  const copy = structuredClone(document)
  const applied: PatchedSpec["applied"] = []
  const problems: string[] = []
  for (const { pointer, value, reason } of options.patches ?? []) {
    if (!pointer.startsWith("/")) {
      problems.push(`patch "${pointer}": a pointer starts with "/"; replacing the whole document is not supported`)
      continue
    }
    const path = pointer.split("/").slice(1).map(decode)
    const key = path.pop() as string
    const parent = path.reduce<unknown>(child, copy)
    if (UNSAFE.has(key) || path.some((segment) => UNSAFE.has(segment))) {
      problems.push(`patch ${pointer}: __proto__, constructor and prototype are not document keys`)
      continue
    }
    if (Array.isArray(parent) && (key === "-" || /^\d+$/.test(key))) {
      parent[key === "-" ? parent.length : Number(key)] = structuredClone(value)
    } else if (isObject(parent)) parent[key] = structuredClone(value)
    else {
      problems.push(`patch ${pointer}: its parent is not in the document`)
      continue
    }
    applied.push({ pointer, reason })
  }
  if (options.stubMissingSchemas) {
    if (!isObject(copy.components)) copy.components = {}
    const components = copy.components as Json
    if (!isObject(components.schemas)) components.schemas = {}
    const schemas = components.schemas as Json
    for (const id of [...refs(copy, new Set())].sort()) {
      if (Object.hasOwn(schemas, id)) continue
      schemas[id] = { description: options.stubMissingSchemas }
      applied.push({ pointer: `/components/schemas/${encode(id)}`, reason: options.stubMissingSchemas })
    }
  }
  if (problems.length > 0) throw new OpenApiError(problems)
  return { document: copy, applied }
}
