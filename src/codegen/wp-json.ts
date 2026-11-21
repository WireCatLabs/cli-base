/**
 * WordPress's REST index (`/wp-json/?context=help`), already parsed → an OpenAPI 3.1 document, so `adaptOpenApi` reads
 * it like any other. WordPress publishes no OpenAPI: the index lists each route's endpoints with their arguments, and
 * with `context=help` also the schema of what the route answers, the same one an `OPTIONS` call returns. One request
 * holds the whole API, so `syncWpJson` keeps that one answer with its provenance and `readWpJson` loads it back only
 * while its hash still matches.
 *
 * Strict like `adaptOpenApi`: a route that cannot become a path template, two routes on one path, or an argument with
 * no type stops generation unless `exclude` names the route with a reason.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Override } from "./model.js"
import { derivedId } from "./openapi.js"
import { CodegenError } from "./pipeline.js"
import { sha256, sortKeys } from "./snapshot.js"

type Json = Record<string, unknown>

const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value)

export interface WpJsonOptions {
  /** The namespaces the CLI offers, as `wp/v2`; every other route is left out and listed in `omissions`. */
  namespaces: readonly string[]
  /** Routes, as the index spells them, left out with the reason. One that matches no route stops generation. */
  exclude?: Readonly<Record<string, string>>
  /** The `site` server variable's default: the host in `https://{site}/wp-json`. */
  site?: string
  /** The WordPress version the snapshot came from, as `info.version`. */
  version?: string
}

export interface WpJsonResult {
  /** An OpenAPI 3.1 document for `adaptOpenApi`. */
  document: Json
  /**
   * For `generate`'s `overrides`: how each collection read pages. WordPress answers the list itself, counts pages from
   * 1 and gives their number in `X-WP-TotalPages`; a page past it is an error, not an empty list.
   */
  overrides: Record<string, Override>
  /** What the document leaves out, one line each, for a reviewer. */
  omissions: string[]
}

/** WordPress's own, beside JSON Schema: which `context` shows a field, and its spelling of `readOnly`. */
const DROPPED = new Set(["context", "readonly", "arg_options", "links", "$schema", "patternProperties", "required"])

/** WordPress names the boolean type `bool` in a few block attributes. */
const typeName = (type: unknown): unknown =>
  type === "bool" ? "boolean" : Array.isArray(type) ? type.map(typeName) : type

/**
 * A secret WordPress makes and answers, as an application password's `password`: read-only, so no caller sets it. The
 * index marks nothing secret, and a post's or a user's `password` is the caller's own input, never answered.
 */
const credential = (name: string, field: unknown): field is Json =>
  object(field) && field.readonly === true && /(^|_)(password|secret|token)$/i.test(name)

/**
 * One JSON Schema draft 4 node, as WordPress writes it, → its OpenAPI 3.1 form: a field's `required: true` joins its
 * object's `required` list, a node with `properties` and no type is an object, and a draft 4 `exclusiveMinimum: true`
 * goes, keeping `minimum`, which accepts one value more and refuses nothing valid. `patternProperties` (block names to their hooks) becomes the object's
 * `additionalProperties`: the keys are free, the values keep their schema.
 */
const schemaOf = (value: unknown, where: string): Json => {
  if (!object(value)) throw new CodegenError([`${where}: expected a schema object`])
  const out: Json = {}
  for (const [key, field] of Object.entries(value)) {
    if (DROPPED.has(key)) continue
    if ((key === "exclusiveMinimum" || key === "exclusiveMaximum") && typeof field === "boolean") continue
    if (key === "type") out.type = typeName(field)
    else if (key === "properties" && object(field))
      out.properties = Object.fromEntries(
        Object.entries(field).map(([name, inner]) => [
          name,
          schemaOf(credential(name, inner) ? { ...inner, format: "password" } : inner, `${where}/properties/${name}`),
        ]),
      )
    else if (key === "items") out.items = schemaOf(field, `${where}/items`)
    else if ((key === "oneOf" || key === "anyOf") && Array.isArray(field))
      // A `required` beside the alternatives names fields each of them holds.
      out[key] = field.map((member, index) =>
        schemaOf(
          object(member) && Array.isArray(value.required) && object(member.properties)
            ? {
                ...member,
                required: [...new Set([...(Array.isArray(member.required) ? member.required : []), ...value.required])],
              }
            : member,
          `${where}/${key}/${index}`,
        ),
      )
    else if (key === "additionalProperties" && object(field))
      out.additionalProperties = schemaOf(field, `${where}/additionalProperties`)
    else out[key] = field
  }
  if (object(value.properties)) {
    const required = [
      ...(Array.isArray(value.required) ? value.required.map(String) : []),
      ...Object.entries(value.properties)
        .filter(([, inner]) => object(inner) && inner.required === true)
        .map(([name]) => name),
    ]
    if (required.length > 0) out.required = [...new Set(required)]
    out.type ??= "object"
  }
  if (object(value.patternProperties) && out.additionalProperties === undefined) {
    const members = Object.entries(value.patternProperties).map(([pattern, inner]) =>
      schemaOf(inner, `${where}/patternProperties/${pattern}`),
    )
    out.additionalProperties = members.length === 1 ? members[0] : { anyOf: members }
  }
  if (out.type === undefined && out.oneOf === undefined && out.anyOf === undefined)
    throw new CodegenError([`${where}: no type`])
  return out
}

/**
 * `(?P<id>[\d]+)` → `{id}`, with the group's pattern; `"slash"` when a value may hold one; `undefined` when the rest
 * is still a pattern, not a path.
 */
const template = (route: string): { path: string; patterns: Record<string, string> } | "slash" | undefined => {
  const patterns: Record<string, string> = {}
  let path = ""
  let at = 0
  while (at < route.length) {
    const start = route.indexOf("(?P<", at)
    if (start < 0) {
      path += route.slice(at)
      break
    }
    path += route.slice(at, start)
    const close = route.indexOf(">", start)
    const name = route.slice(start + 4, close)
    let depth = 1
    let index = close + 1
    let inClass = false
    for (; index < route.length && depth > 0; index++) {
      const char = route[index]
      if (char === "\\") index++
      else if (inClass) inClass = char !== "]"
      else if (char === "[") inClass = true
      else if (char === "(") depth++
      else if (char === ")") depth--
    }
    if (depth > 0) return undefined
    patterns[name] = route.slice(close + 1, index - 1)
    path += `{${name}}`
    at = index
  }
  if (/[()[\]?*+\\^$|]/.test(path)) return undefined
  // A value that may hold a slash, as a template's `theme//slug`, does not fit in one path segment.
  const slashed = (pattern: string) => {
    try {
      const regex = new RegExp(`^(?:${pattern})$`)
      return ["a/b", "1/2", "/", "a/", "/a", "a-b/c_d", "1/a"].some((sample) => regex.test(sample))
    } catch {
      return true
    }
  }
  if (Object.values(patterns).some(slashed)) return "slash"
  return { path, patterns }
}

const BATCH = "batch/v1"

/** Collection reads page with `page` and `per_page` and answer a list; every other answer is one item. */
const isList = (args: Json) => "per_page" in args && "page" in args

/**
 * The OpenAPI document of the routes under `namespaces`. A route offers GET as a read, DELETE as a delete with its
 * arguments in the query (`force=true`), and one write: POST where the route takes it, as WordPress takes the same
 * call by POST, PUT and PATCH. A write's arguments are its JSON body. An array argument in the query travels as one
 * comma-separated value, which WordPress splits, as PHP keeps only the last of a repeated name. A read-only credential
 * field becomes `format: password`, so no generated command prints an answer that may hold it.
 */
export const wpJsonToOpenApi = (index: unknown, options: WpJsonOptions): WpJsonResult => {
  if (!object(index) || !object(index.routes)) throw new CodegenError(["not a WordPress REST index: no routes"])
  // One batch call carries requests to other routes in its body, past every key those routes need.
  if (options.namespaces.includes(BATCH))
    throw new CodegenError([`${BATCH} is never offered: a batch call runs other routes' writes past their own keys`])
  const exclude = options.exclude ?? {}
  const used = new Set<string>()
  const problems: string[] = []
  const omissions: string[] = []
  const paths: Record<string, Json> = {}
  const overrides: Record<string, Override> = {}
  const schemas: Record<string, Json> = {}
  const left = new Map<string, number>()
  const schemaRef = (route: string, schema: unknown): Json => {
    const title = object(schema) && typeof schema.title === "string" ? schema.title : route
    const base = title.replace(/[^A-Za-z0-9]+/g, "_")
    const converted = schemaOf(schema, `${route} schema`)
    let name = base
    for (let n = 2; schemas[name] && JSON.stringify(schemas[name]) !== JSON.stringify(converted); n++)
      name = `${base}${n}`
    schemas[name] = converted
    return { $ref: `#/components/schemas/${name}` }
  }

  for (const [route, raw] of Object.entries(index.routes)) {
    if (!object(raw)) throw new CodegenError([`${route}: not a route`])
    const namespace = String(raw.namespace ?? "")
    if (!options.namespaces.includes(namespace)) {
      left.set(namespace, (left.get(namespace) ?? 0) + 1)
      continue
    }
    // The namespace's own index: the description, not an operation.
    if (route === `/${namespace}`) continue
    if (exclude[route] !== undefined) {
      used.add(route)
      omissions.push(`${route}: excluded — ${exclude[route]}`)
      continue
    }
    const templated = template(route)
    if (templated === "slash") {
      omissions.push(`${route}: left out, as its value may hold a slash, which no path segment carries`)
      continue
    }
    if (!templated) {
      problems.push(`${route}: the route is a pattern no path template expresses; exclude it with a reason`)
      continue
    }
    const { path, patterns } = templated
    if (paths[path]) {
      problems.push(`${route}: a second route on ${path}; exclude one with a reason`)
      continue
    }
    const item: Json = {}
    // The resource after the namespace, `posts` in `/wp/v2/posts/(?P<id>…)`, so `names.groups` can group by it.
    const resource = route.slice(namespace.length + 2).split("/")[0] ?? ""
    const endpoints = Array.isArray(raw.endpoints) ? raw.endpoints.filter(object) : []
    try {
      for (const endpoint of endpoints) {
        const methods = (Array.isArray(endpoint.methods) ? endpoint.methods : []).map(String)
        const args = object(endpoint.args) ? endpoint.args : {}
        const write = ["POST", "PUT", "PATCH"].find((method) => methods.includes(method))
        const dropped = methods.filter((method) => method !== write && ["PUT", "PATCH"].includes(method))
        if (dropped.length > 0) omissions.push(`${route}: ${dropped.join(", ")} left out, as ${write} does the same`)
        for (const method of methods.filter((one) => one === "GET" || one === "DELETE" || one === write)) {
          const verb = method.toLowerCase()
          if (item[verb]) throw new CodegenError([`${route}: two endpoints answer ${method}`])
          const where = `${route} ${method}`
          const pathParameters = Object.entries(patterns).map(([name, pattern]) => ({
            name,
            in: "path",
            required: true,
            schema: object(args[name])
              ? schemaOf(args[name], `${where} ${name}`)
              : { type: "string", pattern: `^(?:${pattern})$` },
          }))
          const rest = Object.entries(args).filter(([name]) => patterns[name] === undefined)
          const operation: Json = { parameters: pathParameters }
          if (/^[A-Za-z][\w-]*$/.test(resource)) operation.tags = [resource]
          if (method === write) {
            if (rest.length > 0)
              operation.requestBody = {
                required: rest.some(([, arg]) => object(arg) && arg.required === true),
                content: {
                  "application/json": {
                    schema: schemaOf({ type: "object", properties: Object.fromEntries(rest) }, `${where} body`),
                  },
                },
              }
          } else
            operation.parameters = [
              ...pathParameters,
              ...rest.map(([name, arg]) => {
                const schema = schemaOf(arg, `${where} ${name}`)
                const list = schema.type === "array" || (Array.isArray(schema.type) && schema.type.includes("array"))
                return {
                  name,
                  in: "query",
                  required: object(arg) && arg.required === true,
                  ...(typeof schema.description === "string" ? { description: schema.description } : {}),
                  schema: list
                    ? { type: "string", description: `${schema.description ?? name}; several, comma-separated` }
                    : schema,
                }
              }),
            ]
          if (raw.schema !== undefined && method !== "DELETE") {
            const ref = schemaRef(route, raw.schema)
            const answer = method === "GET" && isList(args) ? { type: "array", items: ref } : ref
            if (method === "GET" && isList(args))
              overrides[derivedId("get", path)] = {
                pagination: {
                  style: "page",
                  page: { in: "query", name: "page" },
                  limit: { in: "query", name: "per_page" },
                  items: "",
                  start: 1,
                  pagesHeader: "x-wp-totalpages",
                },
                reason: "WordPress counts pages from 1 and gives their number in X-WP-TotalPages",
              }
            operation.responses = { "200": { description: "OK", content: { "application/json": { schema: answer } } } }
          } else operation.responses = { "200": { description: "OK" } }
          item[verb] = operation
        }
      }
    } catch (error) {
      if (!(error instanceof CodegenError)) throw error
      for (const problem of error.problems) problems.push(problem)
      continue
    }
    if (Object.keys(item).length > 0) paths[path] = item
  }
  for (const [namespace, count] of left)
    omissions.push(`${namespace || "routes outside a namespace"}: not offered, ${count} routes`)
  const stale = Object.keys(exclude).filter((route) => !used.has(route))
  for (const route of stale) problems.push(`exclusion "${route}" matches no route — stale, or the route changed`)
  if (problems.length > 0) throw new CodegenError(problems)
  return {
    document: {
      openapi: "3.1.0",
      info: { title: "WordPress REST API", version: options.version ?? "unknown" },
      servers: [{ url: "https://{site}/wp-json", variables: { site: { default: options.site ?? "example.com" } } }],
      // An application password, sent as Basic `<user>:<password>`.
      components: { schemas, securitySchemes: { applicationPassword: { type: "http", scheme: "basic" } } },
      security: [{ applicationPassword: [] }],
      paths,
    },
    omissions,
    overrides,
  }
}

/** The snapshot's entry in `provenance.json`. */
export interface WpJsonProvenance {
  source: string
  /** The WordPress version it came from; the index does not say it. */
  version: string
  /** Of the committed file; `readWpJson` refuses a snapshot that no longer matches it. */
  sha256: string
  retrieved_at: string
  normalization: string
}

const FILE = "wp-json.json"

/** The site's name, address, time zone and links go, the schemas' `links` too: the API is the same from any site. */
const ROUTE_FIELDS = ["namespace", "methods", "endpoints", "schema"]

/**
 * Asks `root` (`https://<site>/wp-json/`) for its index with every schema and writes `wp-json.json` and
 * `provenance.json` to `dir`. Take it from a plain WordPress, as the CLI serves every site: a plugin's routes and
 * fields belong to that site. Run by hand, then review the diff: the build never fetches.
 */
export const syncWpJson = async (options: {
  root: string
  dir: string
  version: string
  fetch?: typeof globalThis.fetch
  now?: Date
}): Promise<WpJsonProvenance> => {
  const fetch = options.fetch ?? globalThis.fetch
  const url = new URL(options.root)
  // The URL goes into provenance.json; a user or password in it must not.
  url.username = ""
  url.password = ""
  url.searchParams.set("context", "help")
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" })
  if (!response.ok) throw new Error(`WordPress index fetch failed: HTTP ${response.status}`)
  const index: unknown = await response.json()
  if (!object(index) || !object(index.routes) || !Array.isArray(index.namespaces))
    throw new Error(`${options.root} is not a WordPress REST index`)
  const routes = Object.fromEntries(
    Object.entries(index.routes).map(([route, value]) => [
      route,
      object(value)
        ? Object.fromEntries(
            ROUTE_FIELDS.filter((key) => key in value).map((key) => {
              const field = value[key]
              if (key !== "schema" || !object(field)) return [key, field]
              const { links: _, ...schema } = field
              return [key, schema]
            }),
          )
        : value,
    ]),
  )
  const written = `${JSON.stringify(sortKeys({ namespaces: index.namespaces, routes }), null, 2)}\n`
  const provenance: WpJsonProvenance = {
    source: url.href,
    version: options.version,
    sha256: sha256(written),
    retrieved_at: (options.now ?? new Date()).toISOString(),
    normalization:
      "the namespaces and each route's namespace, methods, endpoints and schema (without its links); keys sorted, 2-space JSON",
  }
  mkdirSync(options.dir, { recursive: true })
  writeFileSync(join(options.dir, FILE), written)
  writeFileSync(join(options.dir, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`)
  return provenance
}

/** The snapshot `syncWpJson` wrote, parsed. Throws if its hash changed. */
export const readWpJson = (dir: string): unknown => {
  const provenance = JSON.parse(readFileSync(join(dir, "provenance.json"), "utf8")) as { sha256?: string }
  const raw = readFileSync(join(dir, FILE))
  if (sha256(raw) !== provenance.sha256) throw new CodegenError([`WordPress index hash mismatch: ${join(dir, FILE)}`])
  return JSON.parse(raw.toString("utf8"))
}
