/**
 * A Postman collection (v2.0 or v2.1), already parsed → an OpenAPI 3.1 document, so `adaptOpenApi` reads it like any
 * other. A service that publishes only a collection (Braze) gives requests with example values, not schemas: each
 * request becomes an operation named by its method and path, its folders its tag, and its body an open schema of the
 * example's JSON kind, so `adaptOpenApi` marks it an example, never a contract.
 *
 * Strict like `adaptOpenApi`: a request without a URL, a host variable without a default, an auth kind with no OpenAPI
 * equivalent or requests on two hosts stop generation unless `exclude` names the request with a reason.
 */
import { CodegenError } from "./pipeline.js"

type Json = Record<string, unknown>

const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value)

export interface PostmanOptions {
  /** Values for `{{variables}}` the collection leaves empty, as Braze's `instance_url`; they win over its own. */
  variables?: Readonly<Record<string, string>>
  /** Requests, as `METHOD /path` with `{name}` parameters, left out with the reason. A stale one stops generation. */
  exclude?: Readonly<Record<string, string>>
  /** The API version the snapshot came from, as `info.version`; the collection's own when left out. */
  version?: string
}

export interface PostmanResult {
  /** An OpenAPI 3.1 document for `adaptOpenApi`. */
  document: Json
  /** What the document leaves out or merges, one line each, for a reviewer. */
  omissions: string[]
}

/** These travel as the sign-in and the body's type, never as a flag a user types. */
const NOT_PARAMETERS = new Set(["authorization", "content-type", "accept"])

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : object(value) && typeof value.content === "string" ? value.content : undefined

/** v2.1 writes an auth's settings as `[{ key, value }]`, v2.0 as `{ key: value }`. */
const settings = (value: unknown): Record<string, string> =>
  Array.isArray(value)
    ? Object.fromEntries(value.filter(object).map((one) => [String(one.key), String(one.value ?? "")]))
    : object(value)
      ? Object.fromEntries(Object.entries(value).map(([key, one]) => [key, String(one ?? "")]))
      : {}

const pairs = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(object) : [])

/** The open schema of an example's JSON kind: the collection shows one body, it does not say which others are valid. */
const openSchema = (example: unknown): Json =>
  Array.isArray(example)
    ? { type: "array", items: {} }
    : object(example)
      ? { type: "object", additionalProperties: true }
      : example === null
        ? { type: "null" }
        : { type: typeof example === "number" ? "number" : typeof example }

const FLOWS: Record<string, string> = {
  authorization_code: "authorizationCode",
  authorization_code_with_pkce: "authorizationCode",
  client_credentials: "clientCredentials",
  password_credentials: "password",
  implicit: "implicit",
}

/**
 * Converts the collection. A request's path is read from its raw URL, as Braze's export leaves `url.query` empty and
 * keeps the query in the string. `{{x}}`, `:x` and `{x}` in the path become path parameters; the URL's host, with its
 * variables, becomes the server. A request with no `auth` of its own or its folders' signs in as its `Authorization`
 * header shows: Bearer or Basic. Two requests on one method and path (Braze documents some once per channel) become
 * one operation, the first, and the second is listed in `omissions`.
 */
export const postmanToOpenApi = (collection: unknown, options: PostmanOptions = {}): PostmanResult => {
  if (!object(collection) || !object(collection.info) || !Array.isArray(collection.item))
    throw new CodegenError(["not a Postman collection: no info or items"])
  const schema = String(collection.info.schema ?? "")
  if (!/schema\.getpostman\.com\/json\/collection\/v2\./.test(schema))
    throw new CodegenError([`not a Postman collection v2.0 or v2.1: info.schema is ${JSON.stringify(schema)}`])

  const variables: Record<string, string> = {
    ...Object.fromEntries(
      pairs(collection.variable)
        .filter((one) => typeof one.value === "string" && one.value !== "")
        .map((one) => [String(one.key), String(one.value)]),
    ),
    ...options.variables,
  }
  const resolve = (value: string) => value.replace(/\{\{([^}]+)\}\}/g, (all, name: string) => variables[name] ?? all)
  const exclude = options.exclude ?? {}
  const used = new Set<string>()
  const problems: string[] = []
  const omissions: string[] = []
  const paths: Record<string, Json> = {}
  const names = new Map<string, string>()
  const schemes: Record<string, Json> = {}
  let host: string | undefined

  const schemeName = (base: string, scheme: Json): string => {
    let name = base
    for (let n = 2; schemes[name] && JSON.stringify(schemes[name]) !== JSON.stringify(scheme); n++) name = `${base}${n}`
    schemes[name] = scheme
    return name
  }

  /** `undefined` when the request does not say how it signs in; `[]` when it signs in with nothing. */
  const securityOf = (auth: unknown, header: string | undefined, where: string): Json[] | undefined => {
    if (!object(auth)) {
      if (/^bearer\s/i.test(header ?? "")) return [{ [schemeName("bearer", { type: "http", scheme: "bearer" })]: [] }]
      if (/^basic\s/i.test(header ?? "")) return [{ [schemeName("basic", { type: "http", scheme: "basic" })]: [] }]
      return undefined
    }
    const type = String(auth.type)
    const given = settings(auth[type])
    if (type === "noauth") return []
    if (type === "bearer") return [{ [schemeName("bearer", { type: "http", scheme: "bearer" })]: [] }]
    if (type === "basic") return [{ [schemeName("basic", { type: "http", scheme: "basic" })]: [] }]
    if (type === "apikey") {
      if (!given.key) throw new CodegenError([`${where}: an apikey sign-in without the key's name`])
      const scheme = { type: "apiKey", name: resolve(given.key), in: given.in === "query" ? "query" : "header" }
      return [{ [schemeName("apiKey", scheme)]: [] }]
    }
    if (type === "oauth2") {
      const flow = FLOWS[given.grant_type ?? "authorization_code"]
      const tokenUrl = resolve(given.accessTokenUrl ?? "")
      const authorizationUrl = resolve(given.authUrl ?? "")
      const needs =
        flow === "implicit"
          ? [authorizationUrl]
          : flow === "authorizationCode"
            ? [authorizationUrl, tokenUrl]
            : [tokenUrl]
      if (!flow || needs.some((url) => !/^https?:\/\//.test(url)))
        throw new CodegenError([
          `${where}: an oauth2 sign-in needs its grant type and full URLs; give them as variables`,
        ])
      const scopes = Object.fromEntries(
        (given.scope ?? "")
          .split(/\s+/)
          .filter(Boolean)
          .map((one) => [one, one]),
      )
      const scheme = {
        type: "oauth2",
        flows: {
          [flow]: {
            ...(flow === "implicit" || flow === "authorizationCode" ? { authorizationUrl } : {}),
            ...(flow === "implicit" ? {} : { tokenUrl }),
            scopes,
          },
        },
      }
      return [{ [schemeName("oauth2", scheme)]: [] }]
    }
    throw new CodegenError([
      `${where}: the ${type} sign-in has no OpenAPI equivalent; exclude the request with a reason`,
    ])
  }

  const request = (item: Json, folders: string[], inherited: unknown) => {
    const where = [...folders, String(item.name ?? "")].join(" / ")
    const source = object(item.request) ? item.request : { url: item.request }
    const url = source.url
    const structured = object(url) ? url : object(source.urlObject) ? source.urlObject : {}
    const raw = (typeof url === "string" ? url : object(url) && typeof url.raw === "string" ? url.raw : "").trim()
    const [address = "", query = ""] = raw.split(/\?(.*)/s)
    const base = /^(?:[a-z]+:\/\/)?[^/]*/i.exec(address)?.[0] ?? ""
    if (!base) {
      problems.push(`${where}: the request has no URL`)
      return
    }
    const method = String(source.method ?? "GET").toUpperCase()
    const segments = address
      .slice(base.length)
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.replace(/\{\{([^}]+)\}\}/g, "{$1}").replace(/^:(.+)$/, "{$1}"))
    const path = `/${segments.join("/")}`
    const key = `${method} ${path}`
    if (exclude[key] !== undefined) {
      used.add(key)
      omissions.push(`${key}: excluded — ${exclude[key]}`)
      return
    }
    const server = (/^[a-z]+:\/\//i.test(base) || base.startsWith("{{") ? base : `https://${base}`)
      .trim()
      .replace(/\{\{([^}]+)\}\}/g, "{$1}")
    if (host === undefined) host = server
    else if (host !== server) {
      problems.push(`${where}: on ${server}, not ${host}; exclude one with a reason`)
      return
    }
    const verb = method.toLowerCase()
    paths[path] ??= {}
    const entry = paths[path]
    if (entry[verb]) {
      omissions.push(`${key}: "${item.name}" (${where}) merged into "${names.get(key)}", same method and path`)
      return
    }
    names.set(key, String(item.name))

    const described = (list: Json[]) =>
      new Map(list.map((one) => [String(one.key), text(one.description)?.trim()] as const))
    const pathNotes = described(pairs(structured.variable))
    const queryNotes = described(pairs(structured.query))
    const headers = pairs(source.header)
    const parameters: Json[] = [
      ...[...path.matchAll(/\{([^}]+)\}/g)].map(([, name = ""]) => ({
        name,
        in: "path",
        required: true,
        ...(pathNotes.get(name) ? { description: pathNotes.get(name) } : {}),
        schema: { type: "string" },
      })),
      ...[
        ...new Set([
          ...pairs(structured.query).map((one) => String(one.key ?? "")),
          ...query.split("&").map((pair) => decodeURIComponent(pair.split("=")[0] ?? "")),
        ]),
      ]
        .filter(Boolean)
        .map((name) => ({
          name,
          in: "query",
          required: false,
          ...(queryNotes.get(name) ? { description: queryNotes.get(name) } : {}),
          schema: { type: "string" },
        })),
      ...headers
        .filter((one) => !NOT_PARAMETERS.has(String(one.key).toLowerCase()))
        .map((one) => ({
          name: String(one.key),
          in: "header",
          required: one.disabled !== true,
          ...(text(one.description) ? { description: text(one.description) } : {}),
          schema: { type: "string" },
        })),
    ]
    const header = (name: string) =>
      headers.find((one) => String(one.key).toLowerCase() === name && one.disabled !== true)?.value as
        | string
        | undefined

    const operation: Json = { summary: String(item.name ?? key), parameters }
    const description = text(source.description) ?? text(item.description)
    if (description) operation.description = description
    if (folders.length > 0) operation.tags = [folders.join(" / ")]
    try {
      const security = securityOf(
        object(source.auth) && source.auth.type !== "inherit" ? source.auth : inherited,
        header("authorization"),
        where,
      )
      if (security) operation.security = security
    } catch (error) {
      if (!(error instanceof CodegenError)) throw error
      for (const problem of error.problems) problems.push(problem)
      return
    }

    const body = object(source.body) ? source.body : undefined
    const mode = body ? String(body.mode) : undefined
    if (mode === "raw" && typeof body?.raw === "string" && body.raw.trim()) {
      const type = (header("content-type") ?? "application/json").split(";")[0]?.trim() ?? "application/json"
      let example: unknown
      try {
        example = JSON.parse(body.raw)
      } catch {
        if (/json/i.test(type))
          omissions.push(
            `${key}: the body's example is not JSON, so the body is an open object; its notes are left out`,
          )
      }
      operation.requestBody = {
        required: true,
        content: {
          [type]:
            example === undefined
              ? {
                  schema: /json/i.test(type)
                    ? { type: "object", additionalProperties: true }
                    : { type: "string", format: "binary" },
                }
              : { schema: openSchema(example), example },
        },
      }
    } else if ((mode === "urlencoded" || mode === "formdata") && pairs(body?.[mode]).length > 0) {
      const fields = pairs(body?.[mode])
      operation.requestBody = {
        required: true,
        content: {
          [mode === "urlencoded" ? "application/x-www-form-urlencoded" : "multipart/form-data"]: {
            schema: {
              type: "object",
              properties: Object.fromEntries(
                fields.map((one) => [
                  String(one.key),
                  one.type === "file" ? { type: "string", format: "binary" } : { type: "string" },
                ]),
              ),
            },
          },
        },
      }
    } else if (mode && mode !== "raw" && mode !== "urlencoded" && mode !== "formdata")
      omissions.push(`${key}: the body in ${mode} mode is left out`)

    operation.responses = { "200": { description: "OK" } }
    entry[verb] = operation
  }

  const walk = (items: unknown[], folders: string[], inherited: unknown) => {
    for (const item of items.filter(object)) {
      const auth = object(item.auth) && item.auth.type !== "inherit" ? item.auth : inherited
      if (Array.isArray(item.item)) walk(item.item, [...folders, String(item.name ?? "")], auth)
      else request(item, folders, auth)
    }
  }
  walk(collection.item, [], object(collection.auth) ? collection.auth : undefined)

  const serverVariables = Object.fromEntries(
    [...(host ?? "").matchAll(/\{([^}]+)\}/g)].map(([, name = ""]) => [name, variables[name]]),
  )
  for (const [name, value] of Object.entries(serverVariables))
    if (value === undefined) problems.push(`the host variable {{${name}}} has no value; give it in options.variables`)
  const stale = Object.keys(exclude).filter((key) => !used.has(key))
  for (const key of stale) problems.push(`exclusion "${key}" matches no request — stale, or the request changed`)
  if (problems.length > 0) throw new CodegenError(problems)
  const version = options.version ?? text(collection.info.version) ?? "unknown"
  return {
    document: {
      openapi: "3.1.0",
      info: { title: String(collection.info.name ?? "Postman collection"), version },
      ...(host
        ? {
            servers: [
              {
                url: host,
                ...(Object.keys(serverVariables).length > 0
                  ? {
                      variables: Object.fromEntries(
                        Object.entries(serverVariables).map(([name, value]) => [name, { default: value }]),
                      ),
                    }
                  : {}),
              },
            ],
          }
        : {}),
      components: Object.keys(schemes).length > 0 ? { securitySchemes: schemes } : {},
      paths: Object.fromEntries(Object.entries(paths).filter(([, item]) => Object.keys(item).length > 0)),
    },
    omissions,
  }
}
