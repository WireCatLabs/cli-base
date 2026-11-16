/**
 * A strict fake of a service, built from the files `generate` wrote: a `fetch` that answers only the operations the
 * manifest has, refuses an unknown path, query parameter or body field, a value of the wrong type and a missing
 * sign-in, and answers by the response schema. A CLI's test writes only its scenarios: the answers that matter to it.
 * A name typed from memory then fails a test instead of reaching a real account.
 */
import type { ManifestOperation } from "./manifest.js"
import type { SchemaNode } from "./model.js"
import { identifier } from "./names.js"

export interface FakeCall {
  method: string
  url: URL
  /** The matched operation's id; absent on another host. */
  operation?: string
  path: Readonly<Record<string, string>>
  /** A repeated parameter (`?properties=a&properties=b`) as a list. */
  query: Readonly<Record<string, string | readonly string[]>>
  headers: Headers
  /** The parsed JSON body, or the fields of a form or multipart body. */
  body?: unknown
  /** The body as sent, for a file upload. */
  bytes?: Uint8Array
}

export interface FakeAnswer {
  status?: number
  /** A string, bytes, a Blob or a stream is sent as it is (a file download); anything else as JSON. */
  body?: unknown
  headers?: Readonly<Record<string, string>>
}

type Answering = (call: FakeCall) => FakeAnswer | Promise<FakeAnswer>

export interface FakeApiOptions {
  operations: readonly ManifestOperation[]
  definitions: Readonly<Record<string, SchemaNode>>
  /** The server the CLI calls: `https://cloud-api.yandex.net`. */
  baseUrl: string
  /** The header and value every call to `baseUrl` must carry; omit for a service without sign-in. */
  auth?: { header: string; value: string }
  /** Answers by operation id. One without an answer gets a sample built from its response schema, with status 200. */
  answers?: Readonly<Record<string, Answering>>
  /**
   * Other hosts the CLI is sent to by an answer (Yandex Disk's download and upload links), by name or as
   * `*.disk.yandex.net`. A call there must use the service's scheme and must not carry the `auth` header: the token is
   * for the service, not for whoever an answer points at.
   */
  hosts?: Readonly<Record<string, Answering>>
  /** Lets unknown object fields through, for a source whose subtypes the definitions cannot tell apart. */
  looseObjects?: boolean
}

export interface FakeApi {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  /** Every call, in order, the refused ones included. */
  calls: FakeCall[]
  /** Why each refused call was refused; a test that expects none asserts this is empty. */
  refusals: string[]
}

type Definitions = Readonly<Record<string, SchemaNode>>

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const resolved = (node: SchemaNode, definitions: Definitions): SchemaNode => {
  let at = node
  for (let hops = 0; at.type === "ref" && hops < 10; hops++) {
    const target = definitions[identifier(at.ref)]
    if (!target) break
    at = { ...target, ...(at.nullable ? { nullable: true } : {}) }
  }
  return at
}

const nullable = (node: SchemaNode, definitions: Definitions): boolean => {
  const at = resolved(node, definitions)
  return (
    at.nullable === true ||
    at.type === "unknown" ||
    (at.type === "union" && at.of.some((member) => nullable(member, definitions)))
  )
}

// OpenAPI patterns are ECMA-262 without the `u` flag as often as with it; one neither reads is not checked.
const regexOf = (pattern: string): RegExp | undefined => {
  for (const flags of ["u", ""]) {
    try {
      return new RegExp(pattern, flags)
    } catch {}
  }
  return undefined
}

/** Fields of an object node, through references and inheritance, for a strict check of an allOf. */
const objectParts = (
  node: SchemaNode,
  definitions: Definitions,
  seen: ReadonlySet<string> = new Set(),
): { properties: Record<string, SchemaNode>; required: string[] } | undefined => {
  if (node.type === "ref") {
    const target = definitions[identifier(node.ref)]
    return target && !seen.has(node.ref) ? objectParts(target, definitions, new Set([...seen, node.ref])) : undefined
  }
  if (node.type === "object") return { properties: { ...node.properties }, required: [...node.required] }
  if (node.type !== "allOf") return undefined
  const parts = node.of.map((member) => objectParts(member, definitions, seen))
  if (parts.some((part) => part === undefined)) return undefined
  return {
    properties: Object.assign({}, ...parts.map((part) => part?.properties)),
    required: parts.flatMap((part) => part?.required ?? []),
  }
}

/** Every way the value breaks the schema, each with where; an empty list is a match. */
export const schemaProblems = (
  value: unknown,
  node: SchemaNode,
  definitions: Definitions,
  where = "body",
  loose = false,
): string[] => {
  if (value === null) return nullable(node, definitions) ? [] : [`${where}: null is not allowed`]
  const check = (inner: unknown, schema: SchemaNode, at: string) =>
    schemaProblems(inner, schema, definitions, at, loose)
  switch (node.type) {
    case "unknown":
      return []
    case "ref": {
      const target = definitions[identifier(node.ref)]
      return target ? check(value, target, where) : [`${where}: the definitions have no ${node.ref}`]
    }
    case "union":
      return node.of.some((member) => check(value, member, where).length === 0)
        ? []
        : [`${where}: matches none of the ${node.of.length} alternatives`]
    case "allOf": {
      const parts = objectParts(node, definitions)
      if (!parts) return node.of.flatMap((member) => check(value, member, where))
      return check(value, { type: "object", ...parts }, where)
    }
    case "string": {
      if (typeof value !== "string") return [`${where}: expected a string`]
      const problems: string[] = []
      if (node.enum && !node.enum.includes(value))
        problems.push(`${where}: "${value}" is not one of ${node.enum.join(", ")}`)
      if (node.minLength !== undefined && value.length < node.minLength)
        problems.push(`${where}: shorter than ${node.minLength}`)
      if (node.maxLength !== undefined && value.length > node.maxLength)
        problems.push(`${where}: longer than ${node.maxLength}`)
      if (node.pattern !== undefined && regexOf(node.pattern)?.test(value) === false)
        problems.push(`${where}: does not match ${node.pattern}`)
      return problems
    }
    case "integer":
    case "number": {
      // A 64-bit id travels as a decimal string, which a lossless parser gives back as one.
      const number =
        typeof value === "string" && node.type === "integer" && node.format === "int64" && /^-?\d+$/.test(value)
          ? Number(value)
          : value
      if (typeof number !== "number" || (node.type === "integer" && !Number.isInteger(number)))
        return [`${where}: expected ${node.type === "integer" ? "an integer" : "a number"}`]
      const problems: string[] = []
      if (node.minimum !== undefined && number < node.minimum) problems.push(`${where}: below ${node.minimum}`)
      if (node.maximum !== undefined && number > node.maximum) problems.push(`${where}: above ${node.maximum}`)
      if (node.type === "integer" && node.enum && !node.enum.includes(number))
        problems.push(`${where}: ${number} is not one of ${node.enum.join(", ")}`)
      return problems
    }
    case "boolean":
      return typeof value === "boolean" && (!node.enum || node.enum.includes(value))
        ? []
        : [`${where}: expected a boolean`]
    case "array": {
      if (!Array.isArray(value)) return [`${where}: expected an array`]
      const problems = value.flatMap((item, index) => check(item, node.items, `${where}[${index}]`))
      if (node.minItems !== undefined && value.length < node.minItems)
        problems.push(`${where}: fewer than ${node.minItems} items`)
      if (node.maxItems !== undefined && value.length > node.maxItems)
        problems.push(`${where}: more than ${node.maxItems} items`)
      return problems
    }
    case "object": {
      if (!isObject(value)) return [`${where}: expected an object`]
      const problems = node.required
        .filter((name) => value[name] === undefined)
        .map((name) => `${where}.${name}: required`)
      for (const [name, inner] of Object.entries(value)) {
        const property = node.properties[name] ?? node.additionalProperties
        if (property) for (const problem of check(inner, property, `${where}.${name}`)) problems.push(problem)
        else if (!loose) problems.push(`${where}.${name}: no such field`)
      }
      return problems
    }
  }
}

/** A value the schema accepts: the first enum value, the minimum, one array item, every object field. */
export const sampleOf = (
  node: SchemaNode,
  definitions: Definitions,
  seen: ReadonlySet<string> = new Set(),
): unknown => {
  switch (node.type) {
    case "ref": {
      const target = definitions[identifier(node.ref)]
      // A schema that contains itself stops at its first repeat.
      return target && !seen.has(node.ref) ? sampleOf(target, definitions, new Set([...seen, node.ref])) : null
    }
    case "union":
      return node.of[0] ? sampleOf(node.of[0], definitions, seen) : null
    case "allOf": {
      const parts = objectParts(node, definitions)
      return parts ? sampleOf({ type: "object", ...parts }, definitions, seen) : null
    }
    case "string":
      return node.enum?.[0] ?? "x".repeat(Math.max(node.minLength ?? 6, 1)).slice(0, node.maxLength ?? 64)
    case "integer":
    case "number":
      return (node.type === "integer" ? node.enum?.[0] : undefined) ?? node.minimum ?? Math.min(1, node.maximum ?? 1)
    case "boolean":
      return node.enum?.[0] ?? false
    case "array": {
      const item = sampleOf(node.items, definitions, seen)
      // A list that would hold only a schema's repeat of itself is empty instead.
      if (item === null && !nullable(node.items, definitions)) return []
      return Array.from({ length: Math.max(node.minItems ?? 1, 1) }, () => item)
    }
    case "object":
      return Object.fromEntries(
        Object.entries(node.properties).flatMap(([name, property]) => {
          const value = sampleOf(property, definitions, seen)
          return value === null && !node.required.includes(name) ? [] : [[name, value]]
        }),
      )
    case "unknown":
      return {}
  }
}

const raw = (body: unknown): body is string | Uint8Array | ArrayBuffer | Blob | ReadableStream =>
  typeof body === "string" ||
  body instanceof Uint8Array ||
  body instanceof ArrayBuffer ||
  body instanceof Blob ||
  body instanceof ReadableStream

const json = (status: number, body: unknown, headers: Readonly<Record<string, string>> = {}) =>
  raw(body)
    ? new Response(body as ConstructorParameters<typeof Response>[0], { status, headers })
    : new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      })

const matchPath = (template: string, path: string): Record<string, string> | undefined => {
  const names: string[] = []
  const pattern = template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{([^}]+)\}/g, (_, name: string) => {
    names.push(name)
    return "([^/]+)"
  })
  const found = new RegExp(`^${pattern}$`).exec(path)
  if (!found) return undefined
  try {
    return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(found[index + 1] ?? "")]))
  } catch {
    return undefined
  }
}

/** `/a/b` before `/a/{id}`: the template with fewer parameters, then the longer literal text, wins. */
const specificity = (template: string): [number, number] => [
  (template.match(/\{/g) ?? []).length,
  -template.replace(/\{[^}]+\}/g, "").length,
]

const JSON_BODY = /[/+]json\s*(;|$)/i

const hostAnswer = (hosts: FakeApiOptions["hosts"], host: string): Answering | undefined =>
  hosts?.[host] ??
  Object.entries(hosts ?? {}).find(
    ([pattern]) => pattern.startsWith("*.") && host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1,
  )?.[1]

const scalar = (raw: string, node: SchemaNode): unknown => {
  if (node.type === "integer" && node.format === "int64") return raw
  if (node.type === "integer" || node.type === "number") return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw
  if (node.type === "boolean") return raw === "true" ? true : raw === "false" ? false : raw
  return raw
}

export const fakeApi = (options: FakeApiOptions): FakeApi => {
  const base = new URL(options.baseUrl)
  const basePath = base.pathname.replace(/\/$/, "")
  const calls: FakeCall[] = []
  const refusals: string[] = []
  const refuse = (status: number, message: string) => {
    refusals.push(message)
    return json(status, { fake_error: message })
  }
  const definitions = options.definitions
  const problemsOf = (value: unknown, node: SchemaNode, where: string) =>
    schemaProblems(value, node, definitions, where, options.looseObjects)

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const bytes = new Uint8Array(await request.arrayBuffer())
    const text = new TextDecoder().decode(bytes)
    const call: FakeCall = {
      method: request.method,
      url,
      path: {},
      query: Object.fromEntries(
        [...new Set(url.searchParams.keys())].map((name) => {
          const values = url.searchParams.getAll(name)
          return [name, values.length === 1 ? (values[0] as string) : values]
        }),
      ),
      headers: request.headers,
      ...(bytes.length > 0 ? { bytes } : {}),
    }
    calls.push(call)
    if (url.origin !== base.origin) {
      const answer = hostAnswer(options.hosts, url.host)
      if (!answer) return refuse(404, `${url.host} is not a host this fake knows`)
      if (url.protocol !== base.protocol) return refuse(400, `${url.host} was called over ${url.protocol}`)
      if (options.auth && request.headers.has(options.auth.header))
        return refuse(400, `the ${options.auth.header} header was sent to ${url.host}, which is not the service`)
      const { status = 200, body, headers } = await answer(call)
      return json(status, body, headers)
    }
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`))
      return refuse(404, `${url.pathname} is outside ${options.baseUrl}`)
    const path = url.pathname.slice(basePath.length) || "/"
    const candidates = options.operations
      .filter((operation) => operation.binding.kind === "http" && matchPath(operation.binding.path, path) !== undefined)
      .sort((a, b) => {
        const [one, other] = [a, b].map((operation) =>
          specificity(operation.binding.kind === "http" ? operation.binding.path : ""),
        ) as [[number, number], [number, number]]
        return one[0] - other[0] || one[1] - other[1]
      })
    const operation = candidates.find(
      (one) => one.binding.kind === "http" && one.binding.method === request.method.toUpperCase(),
    )
    if (operation?.binding.kind !== "http")
      return refuse(candidates.length > 0 ? 405 : 404, `no operation is ${request.method} ${path}`)
    call.operation = operation.id
    call.path = matchPath(operation.binding.path, path) ?? {}
    const where = `${operation.id}`
    const open = operation.security?.length === 0
    if (options.auth && !open && request.headers.get(options.auth.header) !== options.auth.value)
      return refuse(401, `${where}: no ${options.auth.header} header with the expected sign-in`)

    const problems: string[] = []
    const declared = (location: "query" | "path") => operation.parameters.filter((one) => one.in === location)
    for (const name of url.searchParams.keys())
      if (!declared("query").some((one) => one.name === name)) problems.push(`${where}: no query parameter "${name}"`)
    for (const parameter of [...declared("query"), ...declared("path")]) {
      const values = parameter.in === "query" ? url.searchParams.getAll(parameter.name) : [call.path[parameter.name]]
      const [first] = values
      if (first === undefined) {
        if (parameter.required) problems.push(`${where}: ${parameter.in} parameter "${parameter.name}" is required`)
        continue
      }
      const schema = resolved(parameter.schema, definitions)
      const value =
        schema.type === "array"
          ? values.map((one) => scalar(one as string, resolved(schema.items, definitions)))
          : scalar(first, schema)
      for (const problem of problemsOf(value, schema, `${parameter.in}.${parameter.name}`)) problems.push(problem)
    }
    const schema = operation.request?.schema ? definitions[operation.request.schema] : undefined
    const contentType = operation.request?.contentType
    if (text !== "") {
      if (!operation.request) problems.push(`${where}: takes no body`)
      else if (contentType && !JSON_BODY.test(contentType)) {
        try {
          const form = await new Response(bytes, { headers: request.headers }).formData()
          call.body = Object.fromEntries(form)
          const parts = schema ? objectParts(schema, definitions) : undefined
          for (const name of form.keys())
            if (parts && !(name in parts.properties) && !options.looseObjects)
              problems.push(`body.${name}: no such field`)
        } catch {
          problems.push(`${where}: the body is not ${contentType}`)
        }
      } else {
        try {
          call.body = JSON.parse(text)
        } catch {
          problems.push(`${where}: the body is not JSON`)
        }
        if (schema && call.body !== undefined)
          for (const problem of problemsOf(call.body, schema, "body")) problems.push(problem)
      }
    } else if (operation.request?.required) problems.push(`${where}: a body is required`)
    if (problems.length > 0) {
      for (const problem of problems) refusals.push(problem)
      return json(400, { fake_error: problems.join("; ") })
    }

    const response = operation.response?.schema ? definitions[operation.response.schema] : undefined
    const answering = options.answers?.[operation.id]
    if (!answering) return json(200, response ? sampleOf(response, definitions) : undefined)
    const { status = 200, body, headers } = await answering(call)
    // A scenario that answers off the schema tests a service that does not exist.
    if (status >= 200 && status < 300 && response && body !== undefined) {
      const wrong = problemsOf(body, response, "answer")
      if (wrong.length > 0) throw new Error(`the answer for ${operation.id} breaks its schema: ${wrong.join("; ")}`)
    }
    return json(status, body, headers)
  }
  return { fetch, calls, refusals }
}
