/**
 * Google Discovery documents, already parsed → the format-neutral `ApiModel`, plus the offline
 * snapshot those documents come from: `syncDiscovery` downloads them with their provenance, and
 * `readDiscovery` loads them back only when every hash still matches.
 *
 * Strict like `adaptOpenApi`: an unknown schema keyword, format or parameter location stops generation.
 * Effects come from the HTTP verb; a method the verb misjudges is corrected with `generate`'s `overrides`.
 */
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ApiModel, ApiOperation, ApiSchema, Effect, HttpMethod, SchemaNode } from "./model.js"
import { CodegenError } from "./pipeline.js"

type Json = Record<string, unknown>

const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value)

/** Discovery links point at developers.google.com without the host, which breaks them in generated Markdown. */
const description = (value: unknown): string =>
  String(value ?? "").replace(/\]\((\/workspace\/[^)]+)\)/g, "](https://developers.google.com$1)")

const DESCRIPTIVE = new Set([
  "id",
  "description",
  "format",
  "enumDescriptions",
  "enumDeprecated",
  "readOnly",
  "deprecated",
  "annotations",
  "location",
  "required",
  "repeated",
  "parameterName",
])
const CONSTRAINTS = new Set([
  "type",
  "$ref",
  "properties",
  "items",
  "additionalProperties",
  "enum",
  "default",
  "minimum",
  "maximum",
  "pattern",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "nullable",
])
const FORMATS = new Set([
  "int32",
  "int64",
  "float",
  "double",
  "byte",
  "date",
  "date-time",
  "google-datetime",
  "google-fieldmask",
])
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
/** What the HTTP client sets itself; as flags they would only invite a second, wrong value. */
const TRANSPORT_PARAMETERS = new Set(["key", "oauth_token", "access_token", "upload_protocol", "uploadType"])

export interface DiscoveryMetadata {
  /** OAuth scopes per method id, as the document lists them. */
  scopes: Record<string, string[]>
  /** What the model leaves out, one line each, for a reviewer. */
  omissions: string[]
}

/** Where a service's paths are relative to: a request goes to `rootUrl + servicePath + path`. */
export interface DiscoveryService {
  rootUrl: string
  servicePath: string
}

export interface DiscoveryOptions {
  sourceUrl?: string
  sourceRevision?: string
  /**
   * Method ids left out of the model entirely, each with the reason, as for an override. An id that matches
   * no method stops generation. For a method a CLI cannot serve, such as a `watch` that needs a public webhook.
   */
  exclude?: Readonly<Record<string, string>>
}

export interface DiscoveryResult {
  model: ApiModel
  metadata: DiscoveryMetadata
  services: Record<string, DiscoveryService>
}

/** `documents` maps each service name to its parsed Discovery document; schema ids get the service as a prefix. */
export const adaptDiscovery = (
  documents: Readonly<Record<string, unknown>>,
  options: DiscoveryOptions = {},
): DiscoveryResult => {
  const exclude = options.exclude ?? {}
  const excluded = new Set<string>()
  const schemas: ApiSchema[] = []
  const operations: ApiOperation[] = []
  const metadata: DiscoveryMetadata = { scopes: {}, omissions: [] }
  const services: Record<string, DiscoveryService> = {}
  const fail = (problem: string): never => {
    throw new CodegenError([problem])
  }

  const node = (value: unknown, service: string, where: string): SchemaNode => {
    if (!object(value)) return fail(`${where}: expected a Discovery schema object`)
    for (const key of Object.keys(value))
      if (!DESCRIPTIVE.has(key) && !CONSTRAINTS.has(key)) fail(`${where}: unsupported schema keyword ${key}`)
    if (value.format !== undefined && !FORMATS.has(String(value.format))) fail(`${where}: unsupported format`)
    const common = {
      ...(typeof value.description === "string" ? { description: description(value.description) } : {}),
      ...(value.nullable === true ? { nullable: true } : {}),
      ...(value.deprecated === true ? { deprecated: true } : {}),
      ...(value.default !== undefined ? { default: value.default } : {}),
    }
    if (typeof value.$ref === "string") return { ...common, type: "ref", ref: `${service}_${value.$ref}` }
    const bound = (key: string) => {
      if (value[key] === undefined) return {}
      const n = Number(value[key])
      if (!Number.isFinite(n)) fail(`${where}: invalid numeric bound`)
      return { [key]: n }
    }
    switch (value.type) {
      case "any":
        return { ...common, type: "unknown" }
      case "string":
        return {
          ...common,
          type: "string",
          ...(Array.isArray(value.enum) ? { enum: value.enum.map(String) } : {}),
          ...(typeof value.pattern === "string"
            ? { pattern: value.pattern }
            : value.format === "int64"
              ? { pattern: "^-?\\d+$" }
              : {}),
          ...bound("minLength"),
          ...bound("maxLength"),
        }
      case "integer":
        return {
          ...common,
          type: "integer",
          ...(value.format === "int64" ? { format: "int64" as const } : { format: "int32" as const }),
          ...bound("minimum"),
          ...bound("maximum"),
          ...(Array.isArray(value.enum) ? { enum: value.enum.map(Number) } : {}),
        }
      case "number":
        return { ...common, type: "number", ...bound("minimum"), ...bound("maximum") }
      case "boolean":
        return { ...common, type: "boolean" }
      case "array":
        return {
          ...common,
          type: "array",
          items: node(value.items, service, `${where}/items`),
          ...bound("minItems"),
          ...bound("maxItems"),
        }
      case "object": {
        const properties = object(value.properties) ? value.properties : {}
        return {
          ...common,
          type: "object",
          properties: Object.fromEntries(
            Object.entries(properties).map(([key, item]) => [key, node(item, service, `${where}/properties/${key}`)]),
          ),
          required: Array.isArray(value.required) ? value.required.map(String) : [],
          ...(object(value.additionalProperties)
            ? { additionalProperties: node(value.additionalProperties, service, `${where}/additionalProperties`) }
            : {}),
        }
      }
      default:
        return fail(`${where}: unsupported schema type`)
    }
  }

  for (const [service, source] of Object.entries(documents)) {
    if (!object(source) || source.name !== service || !object(source.schemas) || !object(source.resources))
      fail(`invalid Discovery document: ${service}`)
    const document = source as Json & { schemas: Json; resources: Json }
    if (typeof document.rootUrl !== "string" || typeof document.servicePath !== "string")
      fail(`invalid Discovery document: ${service} has no rootUrl or servicePath`)
    services[service] = { rootUrl: String(document.rootUrl), servicePath: String(document.servicePath) }
    for (const [id, value] of Object.entries(document.schemas))
      schemas.push({ id: `${service}_${id}`, schema: node(value, service, `/schemas/${id}`) })
    const walk = (resources: Json, path: string) => {
      for (const [resource, value] of Object.entries(resources)) {
        if (!object(value)) fail(`invalid resource: ${resource}`)
        const resourceValue = value as Json
        const location = `${path}/${resource}`
        if (object(resourceValue.methods))
          for (const [name, raw] of Object.entries(resourceValue.methods)) {
            if (!object(raw) || typeof raw.id !== "string" || typeof raw.path !== "string")
              return fail(`invalid method at ${location}`)
            if (exclude[raw.id] !== undefined) {
              excluded.add(raw.id)
              metadata.omissions.push(`${raw.id}: excluded — ${exclude[raw.id]}`)
              continue
            }
            const method = String(raw.httpMethod) as HttpMethod
            if (!METHODS.has(method)) fail(`unsupported HTTP method: ${raw.id}`)
            const effect: Effect =
              method === "GET" || method === "HEAD" ? "read" : method === "DELETE" ? "destructive" : "write"
            metadata.scopes[raw.id] = Array.isArray(raw.scopes) ? raw.scopes.map(String) : []
            const common = object(document.parameters) ? document.parameters : {}
            const parameters = { ...common, ...(object(raw.parameters) ? raw.parameters : {}) }
            const safe = Object.entries(parameters).filter(([key]) => !TRANSPORT_PARAMETERS.has(key))
            const operation: ApiOperation = {
              id: raw.id,
              binding: { kind: "http", method, path: raw.path },
              effect,
              summary: description(raw.description ?? raw.id).split("\n")[0],
              description: description(raw.description),
              tags: [service],
              parameters: safe.map(([key, value]) => {
                if (!object(value) || !["path", "query"].includes(String(value.location)))
                  return fail(`unsupported parameter: ${raw.id}/${key}`)
                const schema = node(value, service, `${location}/methods/${name}/parameters/${key}`)
                return {
                  name: key,
                  in: value.location as "path" | "query",
                  required: value.required === true,
                  ...(typeof value.description === "string" ? { description: description(value.description) } : {}),
                  schema: value.repeated === true ? { type: "array" as const, items: schema } : schema,
                }
              }),
              source: { location: `${service}${location}/methods/${name}` },
              ...(raw.deprecated === true ? { deprecated: true } : {}),
            }
            if (object(raw.request))
              operation.requestBody = {
                confidence: "contract",
                required: raw.request.required === true,
                schema: node(raw.request, service, `${location}/methods/${name}/request`),
              }
            if (object(raw.response))
              operation.response = {
                confidence: "contract",
                schema: node(raw.response, service, `${location}/methods/${name}/response`),
                required: false,
              }
            if (raw.supportsMediaUpload || raw.supportsMediaDownload)
              metadata.omissions.push(`${raw.id}: JSON endpoint only; media transport is not generated`)
            operations.push(operation)
          }
        if (object(resourceValue.resources)) walk(resourceValue.resources, `${location}/resources`)
      }
    }
    walk(document.resources, "/resources")
  }

  const stale = Object.keys(exclude).filter((id) => !excluded.has(id))
  if (stale.length > 0)
    throw new CodegenError(stale.map((id) => `exclusion "${id}" matches no method — stale, or the id changed`))

  return {
    model: {
      source: {
        kind: "other",
        sourceUrl: options.sourceUrl ?? "https://developers.google.com/discovery",
        ...(options.sourceRevision !== undefined ? { sourceRevision: options.sourceRevision } : {}),
      },
      operations: operations.sort((a, b) => a.id.localeCompare(b.id)),
      schemas,
    },
    metadata,
    services,
  }
}

/** One service's entry in `provenance.json`. */
export interface DiscoveryProvenance {
  source: string
  revision: string
  version: string
  /** Of the committed file; `readDiscovery` refuses a snapshot that no longer matches it. */
  sha256: string
  /** Of the bytes Google served. Equal to `sha256` unless the file was normalized after download. */
  sourceSha256: string
  normalization: string
}

export interface SyncDiscoveryOptions {
  /** Where `<service>.json` and `provenance.json` are written. */
  dir: string
  fetch?: typeof globalThis.fetch
}

const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex")

/**
 * Downloads each Discovery document byte for byte and records where it came from. Run by hand, then review
 * the diff: the build never fetches. `provenance.json` keeps the order of `sources`, and that order is
 * the order of the generated schemas.
 */
export const syncDiscovery = async (
  sources: Readonly<Record<string, string>>,
  options: SyncDiscoveryOptions,
): Promise<Record<string, DiscoveryProvenance>> => {
  const fetch = options.fetch ?? globalThis.fetch
  const provenance: Record<string, DiscoveryProvenance> = {}
  const downloaded: Record<string, string> = {}
  for (const [service, source] of Object.entries(sources)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(30_000), redirect: "error" })
    if (!response.ok) throw new Error(`Google Discovery fetch failed for ${service}: HTTP ${response.status}`)
    const raw = await response.text()
    const document: unknown = JSON.parse(raw)
    if (!object(document) || document.name !== service)
      throw new Error(`${source} is not the Discovery document of ${service}`)
    const hash = sha256(raw)
    downloaded[service] = raw
    provenance[service] = {
      source,
      revision: String(document.revision),
      version: String(document.version),
      sha256: hash,
      sourceSha256: hash,
      normalization: "none",
    }
  }
  mkdirSync(options.dir, { recursive: true })
  for (const [service, raw] of Object.entries(downloaded)) writeFileSync(join(options.dir, `${service}.json`), raw)
  writeFileSync(join(options.dir, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`)
  return provenance
}

/** The snapshots `syncDiscovery` wrote, parsed, in `provenance.json` order. Throws if a file's hash changed. */
export const readDiscovery = (dir: string): Record<string, unknown> => {
  const provenance = JSON.parse(readFileSync(join(dir, "provenance.json"), "utf8")) as Record<
    string,
    { sha256: string }
  >
  const documents: Record<string, unknown> = {}
  for (const [service, entry] of Object.entries(provenance)) {
    const raw = readFileSync(join(dir, `${service}.json`))
    if (sha256(raw) !== entry.sha256) throw new CodegenError([`Discovery hash mismatch: ${service}`])
    documents[service] = JSON.parse(raw.toString("utf8"))
  }
  return documents
}
