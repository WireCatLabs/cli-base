/**
 * An OpenAPI 3.0 or 3.1 document, already parsed from YAML or JSON → the format-neutral `ApiModel`. Swagger 1.2 and
 * 2.0 come here through `upgradeToOpenApi3`.
 *
 * Strict on purpose: a keyword this does not understand stops generation and names the place,
 * because a constraint dropped here is a request the server refuses at run time.
 */
import type {
  ApiBody,
  ApiModel,
  ApiOperation,
  ApiParameter,
  ApiSchema,
  ApiServer,
  Effect,
  HttpMethod,
  SchemaNode,
  SecurityRequirement,
  SecurityScheme,
} from "./model.js"

type Json = Record<string, unknown>
type Node<T extends SchemaNode["type"]> = Extract<SchemaNode, { type: T }>
type Common = { description?: string; nullable?: boolean; deprecated?: boolean; default?: unknown }

const METHODS = ["get", "post", "put", "patch", "delete", "head"] as const

/**
 * Carried by the model, or harmless to lose. `not` only narrows what a payload may hold; losing it
 * accepts more, never refuses a valid request.
 */
const IGNORED = new Set(["readOnly", "example", "examples", "externalDocs", "title", "xml", "writeOnly", "not"])
const KNOWN = new Set([
  ...IGNORED,
  "type",
  "format",
  "description",
  "nullable",
  "deprecated",
  "default",
  "enum",
  "const",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "properties",
  "required",
  "additionalProperties",
  "allOf",
  "oneOf",
  "anyOf",
  "$ref",
  "discriminator",
])
const PRIMITIVE_CONSTRAINTS = ["pattern", "minLength", "maxLength", "minimum", "maximum", "enum"]

/** What the HTTP client sets itself; as flags they would only invite a second, wrong value. */
const TRANSPORT_HEADERS = new Set(["authorization", "user-agent", "content-type", "accept"])

/** What a body may be sent as, in the order an operation offering several is read. */
const JSON_TYPE = "application/json"
const MULTIPART = "multipart/form-data"
const FORM = "application/x-www-form-urlencoded"

/** Any of these anywhere in a body schema means someone wrote a contract, not a sample. */
const CONTRACT_MARKS = [
  "$ref",
  "description",
  "required",
  "enum",
  "const",
  "pattern",
  "minLength",
  "maxLength",
  "allOf",
  "oneOf",
  "anyOf",
]

export class OpenApiError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`the OpenAPI document cannot be adapted:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`)
    this.name = "OpenApiError"
    this.problems = problems
  }
}

export const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const EFFECT_BY_METHOD: Record<HttpMethod, Effect> = {
  GET: "read",
  HEAD: "read",
  POST: "write",
  PUT: "write",
  PATCH: "write",
  DELETE: "destructive",
}

const JSON_VARIANT = /^application\/([\w.-]+\+)?json\s*(;|$)/i

/** `application/json`, else a JSON variant: `application/hal+json`, `application/json; charset=utf-8`. */
const jsonContent = (content: Json): unknown =>
  content[JSON_TYPE] ?? Object.entries(content).find(([type]) => JSON_VARIANT.test(type))?.[1]

const SCHEME_TYPES = new Set<SecurityScheme["type"]>(["apiKey", "http", "oauth2", "openIdConnect", "mutualTLS"])
const FLOWS = ["implicit", "password", "clientCredentials", "authorizationCode"] as const

/** A spec without a single operationId (Attio's) still has calls: `get /v2/objects/{object}` → `getV2ObjectsByObject`. */
const derivedId = (method: string, path: string): string =>
  method +
  path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const words = segment
        .replace(/^\{|\}$/g, "")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
      const pascal = words.map((word) => (word[0] ?? "").toUpperCase() + word.slice(1)).join("")
      return segment.startsWith("{") ? `By${pascal}` : pascal
    })
    .join("")

/** A sample answer bigger than this stays in the spec: the manifest ships inside every CLI. */
const LARGEST_EXAMPLE = 8 * 1024

const exampleOf = (media: Json): unknown => {
  const examples = isObject(media.examples) ? Object.values(media.examples) : []
  const first = examples.find((one) => isObject(one) && one.value !== undefined) as Json | undefined
  const example = media.example ?? first?.value
  if (example === undefined) return undefined
  return JSON.stringify(example).length <= LARGEST_EXAMPLE ? example : undefined
}

const strings = (source: Json, keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(keys.flatMap((key) => (typeof source[key] === "string" ? [[key, source[key]]] : [])))

/** `{type: "null"}` or `type: ["null"]`: JSON Schema 2020-12's own way to say "only null". */
const isNullOnly = (source: unknown): boolean =>
  isObject(source) &&
  (source.type === "null" ||
    (Array.isArray(source.type) && source.type.length > 0 && source.type.every((t) => t === "null")))

const pick = (source: Json, keys: readonly string[]): Json => Object.fromEntries(keys.map((key) => [key, source[key]]))

const typeOfConst = (value: unknown): string | undefined =>
  typeof value === "string"
    ? "string"
    : typeof value === "boolean"
      ? "boolean"
      : Number.isInteger(value)
        ? "integer"
        : typeof value === "number"
          ? "number"
          : undefined

/**
 * A body typed from a sample request: only `type` and `example` all the way down. Its field types
 * are what one example happened to hold, so the model must never treat it as a contract.
 */
const typedFromExample = (schema: unknown): boolean => {
  const marked = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.some(marked)
    if (!isObject(node)) return false
    if (CONTRACT_MARKS.some((mark) => node[mark] !== undefined)) return true
    return Object.entries(node).some(([key, value]) => key !== "example" && marked(value))
  }
  return isObject(schema) && !marked(schema)
}

class Adapter {
  readonly problems: string[] = []
  readonly document: Json
  readonly #components: Json
  readonly #parameters: Json
  readonly #distributing = new Set<string>()

  constructor(document: Json) {
    this.document = document
    const components = isObject(document.components) ? document.components : {}
    this.#components = isObject(components.schemas) ? components.schemas : {}
    this.#parameters = isObject(components.parameters) ? components.parameters : {}
  }

  refId(ref: unknown, where: string): string {
    const prefix = "#/components/schemas/"
    if (typeof ref === "string" && ref.startsWith(prefix)) return ref.slice(prefix.length)
    this.problems.push(`${where}: unsupported reference ${JSON.stringify(ref)}`)
    return "Unknown"
  }

  /** A parameter given as a `$ref` into `components/parameters`, followed once. */
  #parameterSource(source: unknown, where: string): unknown {
    if (!isObject(source) || source.$ref === undefined) return source
    const prefix = "#/components/parameters/"
    const ref = source.$ref
    if (typeof ref === "string" && ref.startsWith(prefix) && isObject(this.#parameters[ref.slice(prefix.length)]))
      return this.#parameters[ref.slice(prefix.length)]
    this.problems.push(`${where}: unsupported reference ${JSON.stringify(ref)}`)
    return undefined
  }

  #common(source: Json): Common {
    const common: Common = {}
    if (typeof source.description === "string" && source.description.trim()) common.description = source.description
    if (source.nullable === true) common.nullable = true
    if (source.deprecated === true) common.deprecated = true
    if (source.default !== undefined) common.default = source.default
    return common
  }

  /** OpenAPI 3.1 writes `nullable` as `type: [T, "null"]`. */
  #type(source: Json, common: Common, where: string): unknown {
    if (Array.isArray(source.type)) {
      const types = source.type.filter((type) => type !== "null")
      if (types.length !== source.type.length) common.nullable = true
      if (types.length === 1) return types[0]
      this.problems.push(`${where}: a schema of several types ${JSON.stringify(source.type)}`)
      return null
    }
    if (source.type !== undefined) return source.type
    if (source.const !== undefined) return typeOfConst(source.const)
    if (Array.isArray(source.enum)) {
      const types = new Set(source.enum.map(typeOfConst))
      if (types.size === 1) return [...types][0]
    }
    if (source.items !== undefined) return "array"
    if (source.properties !== undefined || source.required !== undefined || source.additionalProperties !== undefined)
      return "object"
    return undefined
  }

  schema(source: unknown, where: string): SchemaNode {
    if (!isObject(source)) {
      this.problems.push(`${where}: a schema must be an object`)
      return { type: "unknown" }
    }
    for (const keyword of Object.keys(source)) {
      if (!KNOWN.has(keyword) && !keyword.startsWith("x-")) {
        this.problems.push(`${where}: unsupported keyword "${keyword}"`)
      }
    }
    const common = this.#common(source)

    if (source.$ref !== undefined) return { ...common, type: "ref", ref: this.refId(source.$ref, where) }

    // The model has no null type; "anything" accepts the one value this allows, as losing `not` does.
    if (isNullOnly(source)) return { ...common, type: "unknown" }

    if (Array.isArray(source.allOf)) return this.#allOf(source, source.allOf, common, where)

    if (Array.isArray(source.oneOf) && Array.isArray(source.anyOf)) {
      this.problems.push(`${where}: both oneOf and anyOf on one schema`)
      return { type: "unknown" }
    }
    // A union passes when any member matches, which is anyOf; oneOf's "exactly one" is never checked.
    const keyword = Array.isArray(source.oneOf) ? "oneOf" : Array.isArray(source.anyOf) ? "anyOf" : undefined
    if (keyword) {
      if (Array.isArray(source.type) && source.type.includes("null")) common.nullable = true
      return this.#union(source[keyword] as unknown[], keyword, common, where)
    }

    const type = this.#type(source, common, where)
    const values = source.const !== undefined ? [source.const] : Array.isArray(source.enum) ? source.enum : undefined
    switch (type) {
      case "string": {
        const node: Node<"string"> = { ...common, type: "string" }
        if (values) node.enum = values.map(String)
        if (source.format === "binary") node.format = "binary"
        if (typeof source.minLength === "number") node.minLength = source.minLength
        if (typeof source.maxLength === "number") node.maxLength = source.maxLength
        if (typeof source.pattern === "string") node.pattern = source.pattern
        return node
      }
      case "integer": {
        const node: Node<"integer"> = { ...common, type: "integer" }
        if (source.format === "int32" || source.format === "int64") node.format = source.format
        else if (source.format !== undefined)
          this.problems.push(`${where}: unsupported integer format "${source.format}"`)
        if (typeof source.minimum === "number") node.minimum = source.minimum
        if (typeof source.maximum === "number") node.maximum = source.maximum
        if (values) node.enum = values.map(Number)
        return node
      }
      case "number": {
        const node: Node<"number"> = { ...common, type: "number" }
        if (typeof source.minimum === "number") node.minimum = source.minimum
        if (typeof source.maximum === "number") node.maximum = source.maximum
        return node
      }
      case "boolean": {
        const node: Node<"boolean"> = { ...common, type: "boolean" }
        if (values) node.enum = values.map((value) => value === true)
        return node
      }
      case "array": {
        // JSON Schema reads a missing `items` as "any item".
        const items =
          source.items === undefined ? { type: "unknown" as const } : this.schema(source.items, `${where}[]`)
        const node: Node<"array"> = { ...common, type: "array", items }
        if (typeof source.minItems === "number") node.minItems = source.minItems
        if (typeof source.maxItems === "number") node.maxItems = source.maxItems
        if (source.uniqueItems === true) node.uniqueItems = true
        return node
      }
      case "object":
        return this.#object(source, common, where)
      case null:
        return { type: "unknown" }
      case undefined:
        if (Object.keys(source).every((keyword) => IGNORED.has(keyword) || keyword === "description")) {
          return { ...common, type: "unknown" }
        }
        this.problems.push(`${where}: a schema with no type`)
        return { type: "unknown" }
      default:
        this.problems.push(`${where}: unsupported type ${JSON.stringify(type)}`)
        return { type: "unknown" }
    }
  }

  #object(source: Json, common: Common, where: string): SchemaNode {
    const properties: Record<string, SchemaNode> = {}
    for (const [name, property] of Object.entries(isObject(source.properties) ? source.properties : {})) {
      properties[name] = this.schema(property, `${where}.${name}`)
    }
    const node: Node<"object"> = {
      ...common,
      type: "object",
      properties,
      required: Array.isArray(source.required) ? source.required.map(String) : [],
    }
    // `true` and `{}` say "anything else may appear", which a loose object already allows.
    if (isObject(source.additionalProperties) && Object.keys(source.additionalProperties).length > 0) {
      node.additionalProperties = this.schema(source.additionalProperties, `${where}.*`)
    }
    return node
  }

  /** OpenAPI 3.1 writes a nullable reference as `oneOf: [{$ref}, {type: "null"}]`. */
  #union(members: unknown[], keyword: string, common: Common, where: string): SchemaNode {
    const kept = members.flatMap((member, index) => (isNullOnly(member) ? [] : [{ member, index }]))
    const of = kept.map(({ member, index }) => this.schema(member, `${where}.${keyword}[${index}]`))
    if (kept.length === members.length) return { ...common, type: "union", of }
    const [only] = of
    if (!only) return { ...common, type: "unknown" }
    if (of.length === 1) return { ...only, ...common, nullable: true }
    return { ...common, nullable: true, type: "union", of }
  }

  /** The members of a union an allOf member stands for, inline or behind references; never a discriminated base. */
  #unionMembers(member: unknown, seen = new Set<string>()): { ref?: string; members: unknown[] } | undefined {
    if (!isObject(member) || Array.isArray(member.allOf)) return undefined
    const members = Array.isArray(member.oneOf) ? member.oneOf : Array.isArray(member.anyOf) ? member.anyOf : undefined
    if (members) return isObject(member.discriminator) ? undefined : { members }
    const prefix = "#/components/schemas/"
    if (typeof member.$ref !== "string" || !member.$ref.startsWith(prefix) || seen.has(member.$ref)) return undefined
    seen.add(member.$ref)
    const found = this.#unionMembers(this.#components[member.$ref.slice(prefix.length)], seen)
    return found && { ref: found.ref ?? member.$ref.slice(prefix.length), members: found.members }
  }

  /**
   * A and (B or C) is (A and B) or (A and C): the model merges only objects, so the one union member is
   * distributed over the rest, as Notion's property configs extend a common base.
   */
  #distribute(members: unknown[], common: Common, where: string): SchemaNode | undefined {
    const unions = members.flatMap((member) => {
      const found = this.#unionMembers(member)
      return found ? [{ member, ...found }] : []
    })
    if (unions.length === 0) return undefined
    const [union] = unions
    if (unions.length > 1 || !union) {
      this.problems.push(`${where}: an allOf of several unions`)
      return { type: "unknown" }
    }
    if (union.ref && this.#distributing.has(union.ref)) {
      this.problems.push(`${where}: an allOf distributes the union "${union.ref}" inside itself`)
      return { type: "unknown" }
    }
    const rest = members.filter((member) => member !== union.member)
    // Alone, the allOf only describes a reference, which keeps its name.
    if (rest.length === 0) return undefined
    // Null would also have to pass the rest, which the model only merges as objects: that alternative is empty.
    const alternatives = union.members.filter((one) => !isNullOnly(one)).map((one) => ({ allOf: [...rest, one] }))
    if (union.ref) this.#distributing.add(union.ref)
    try {
      return this.#union(alternatives, "union", common, where)
    } finally {
      if (union.ref) this.#distributing.delete(union.ref)
    }
  }

  #allOf(source: Json, members: unknown[], common: Common, where: string): SchemaNode {
    const distributed = this.#distribute(members, common, where)
    if (distributed) return distributed
    const of = members.map((member, index) => this.schema(member, `${where}.allOf[${index}]`))
    const [only] = of
    // `type: object` beside a one-member allOf is inheritance with no fields of its own; without it,
    // the allOf only attaches a description or `nullable` to a reference.
    if (of.length !== 1 || !only || source.type === "object") return { ...common, type: "allOf", of }

    const constraints = PRIMITIVE_CONSTRAINTS.filter((keyword) => source[keyword] !== undefined)
    if (constraints.length === 0) return { ...only, ...common }
    if (only.type !== "ref") {
      this.problems.push(`${where}: constraints beside a non-reference allOf member`)
      return only
    }
    const target = this.#components[only.ref]
    const inlined = this.schema({ ...(isObject(target) ? target : {}), ...pick(source, constraints) }, where)
    if (inlined.type === "object" || inlined.type === "allOf") {
      this.problems.push(`${where}: constraints ${constraints.join(", ")} beside a reference to an object`)
    }
    return { ...inlined, ...common }
  }

  components(): ApiSchema[] {
    return Object.entries(this.#components).map(([id, source]) => {
      const where = `#/components/schemas/${id}`
      const schema: ApiSchema = { id, schema: this.schema(source, where) }
      if (isObject(source) && isObject(source.discriminator)) {
        const { propertyName, mapping } = source.discriminator
        if (typeof propertyName !== "string" || !isObject(mapping)) {
          this.problems.push(`${where}: a discriminator needs propertyName and an explicit mapping`)
        } else {
          schema.discriminator = {
            property: propertyName,
            mapping: Object.fromEntries(
              Object.entries(mapping).map(([value, ref]) => [value, this.refId(ref, `${where}.discriminator`)]),
            ),
          }
        }
      }
      return schema
    })
  }

  #parameter(reference: unknown, where: string): ApiParameter | undefined {
    const source = this.#parameterSource(reference, where)
    if (source === undefined) return undefined
    if (!isObject(source) || typeof source.name !== "string") {
      this.problems.push(`${where}: a parameter needs a name`)
      return undefined
    }
    if (source.in === "header" && TRANSPORT_HEADERS.has(source.name.toLowerCase())) return undefined
    if (source.in !== "path" && source.in !== "query" && source.in !== "header") {
      this.problems.push(`${where}: parameter "${source.name}" is in ${JSON.stringify(source.in)}`)
      return undefined
    }
    const parameter: ApiParameter = {
      name: source.name,
      in: source.in,
      required: source.required === true || source.in === "path",
      schema: this.schema(source.schema, `${where}.${source.name}`),
    }
    if (typeof source.description === "string" && source.description.trim()) parameter.description = source.description
    return parameter
  }

  /**
   * JSON when offered, unless a multipart body carries a file, which JSON cannot; then multipart,
   * then a form. A content type outside these three refuses the operation.
   */
  #requestBody(source: Json, where: string): ApiBody {
    const content = isObject(source.content) ? source.content : {}
    const schemaOf = (type: string): unknown => (isObject(content[type]) ? content[type].schema : undefined)
    const carriesFile = JSON.stringify(schemaOf(MULTIPART) ?? {}).includes('"format":"binary"')
    const offered = Object.keys(content)
    const json =
      offered.find((candidate) => candidate === JSON_TYPE) ?? offered.find((candidate) => JSON_VARIANT.test(candidate))
    const type = carriesFile ? MULTIPART : (json ?? [MULTIPART, FORM].find((candidate) => offered.includes(candidate)))
    const body: ApiBody = { confidence: "contract", required: source.required === true }
    if (offered.length === 0) return body
    if (!type) {
      this.problems.push(`${where}: a body must be JSON, multipart or a form, found ${offered.join(", ")}`)
      return body
    }
    // Only a charset may be dropped: `application/merge-patch+json` must travel as itself.
    if (type.split(";")[0]?.trim().toLowerCase() !== JSON_TYPE) body.contentType = type
    const schema = schemaOf(type)
    if (schema === undefined) return body
    if (typedFromExample(schema)) body.confidence = "example"
    body.schema = this.schema(schema, `${where}.requestBody`)
    return body
  }

  /**
   * The first 2xx answer with JSON (HubSpot creates with 201, Yandex Disk with 201 or 202). Only an inline answer has a
   * shape to check; a file, plain text or a `$ref` to a shared response is passed through as it is. Nothing at run time
   * validates an answer yet.
   */
  #response(source: Json, where: string): ApiBody | undefined {
    const responses = isObject(source.responses) ? source.responses : {}
    for (const code of Object.keys(responses)
      .filter((code) => /^2(\d\d|XX)$/i.test(code))
      .sort()) {
      const answer = responses[code]
      const json = isObject(answer) && isObject(answer.content) ? jsonContent(answer.content) : undefined
      if (!isObject(json) || json.schema === undefined) continue
      const example = exampleOf(json)
      return {
        confidence: "contract",
        required: true,
        schema: this.schema(json.schema, `${where}.responses.${code}`),
        ...(example === undefined ? {} : { example }),
      }
    }
    return undefined
  }

  security(source: unknown, where: string): SecurityRequirement[] | undefined {
    if (source === undefined) return undefined
    if (!Array.isArray(source) || !source.every(isObject)) {
      this.problems.push(`${where}: security must be a list of requirements`)
      return undefined
    }
    return source.map((requirement) =>
      Object.fromEntries(
        Object.entries(requirement).map(([name, scopes]) => [name, Array.isArray(scopes) ? scopes.map(String) : []]),
      ),
    )
  }

  securitySchemes(): Record<string, SecurityScheme> | undefined {
    const components = isObject(this.document.components) ? this.document.components : {}
    if (!isObject(components.securitySchemes)) return undefined
    const schemes: Record<string, SecurityScheme> = {}
    for (const [name, source] of Object.entries(components.securitySchemes)) {
      const where = `#/components/securitySchemes/${name}`
      if (isObject(source) && source.$ref !== undefined) {
        this.problems.push(`${where}: a $ref security scheme is not supported; write the scheme in place`)
        continue
      }
      if (!isObject(source) || !SCHEME_TYPES.has(source.type as SecurityScheme["type"])) {
        this.problems.push(
          `${where}: unsupported security scheme ${JSON.stringify(isObject(source) ? source.type : source)}`,
        )
        continue
      }
      const scheme = {
        ...strings(source, ["description", "name", "in", "scheme", "bearerFormat", "openIdConnectUrl"]),
        type: source.type,
      } as SecurityScheme
      if (isObject(source.flows)) {
        const flows = source.flows
        scheme.flows = Object.fromEntries(
          FLOWS.flatMap((flow) => {
            const one = flows[flow]
            if (!isObject(one)) return []
            const scopes = isObject(one.scopes)
              ? Object.fromEntries(Object.entries(one.scopes).map(([k, v]) => [k, String(v)]))
              : {}
            return [[flow, { ...strings(one, ["authorizationUrl", "tokenUrl", "refreshUrl"]), scopes }]]
          }),
        )
      }
      schemes[name] = scheme
    }
    return schemes
  }

  servers(): ApiServer[] | undefined {
    if (!Array.isArray(this.document.servers)) return undefined
    return this.document.servers.flatMap((source) => {
      if (!isObject(source) || typeof source.url !== "string") return []
      const server: ApiServer = { url: source.url, ...strings(source, ["description"]) }
      if (isObject(source.variables)) {
        server.variables = Object.fromEntries(
          Object.entries(source.variables).flatMap(([name, variable]) =>
            isObject(variable) && variable.default !== undefined
              ? [
                  [
                    name,
                    {
                      default: String(variable.default),
                      ...(Array.isArray(variable.enum) ? { enum: variable.enum.map(String) } : {}),
                      ...strings(variable, ["description"]),
                    },
                  ],
                ]
              : [],
          ),
        )
      }
      return [server]
    })
  }

  operations(): ApiOperation[] {
    const operations: ApiOperation[] = []
    const paths = isObject(this.document.paths) ? this.document.paths : {}
    const named = Object.values(paths).some(
      (item) => isObject(item) && METHODS.some((method) => isObject(item[method]) && "operationId" in item[method]),
    )
    for (const [path, item] of Object.entries(paths)) {
      if (!isObject(item)) continue
      const shared = Array.isArray(item.parameters) ? item.parameters : []
      for (const method of METHODS) {
        const source = item[method]
        if (!isObject(source)) continue
        const pointer = `#/paths/${path.replaceAll("~", "~0").replaceAll("/", "~1")}/${method}`
        // A path without an id is a description, not a call: Meta models its webhook payload this way.
        if (named && typeof source.operationId !== "string") continue
        const id = typeof source.operationId === "string" ? source.operationId : derivedId(method, path)
        const verb = method.toUpperCase() as HttpMethod
        const own = (Array.isArray(source.parameters) ? source.parameters : [])
          .map((parameter, index) => this.#parameter(parameter, `${pointer}.parameters[${index}]`))
          .filter((parameter): parameter is ApiParameter => parameter !== undefined)
        const inherited = shared
          .map((parameter, index) =>
            this.#parameter(parameter, `${pointer.replace(/\/[a-z]+$/, "")}.parameters[${index}]`),
          )
          .filter(
            (parameter): parameter is ApiParameter =>
              parameter !== undefined && !own.some((mine) => mine.name === parameter.name && mine.in === parameter.in),
          )
        const parameters = [...inherited, ...own]
        for (const [, name] of path.matchAll(/\{([^}]+)\}/g)) {
          if (!parameters.some((parameter) => parameter.in === "path" && parameter.name === name))
            this.problems.push(`${pointer}: path parameter "${name}" is not declared`)
        }
        const operation: ApiOperation = {
          id,
          binding: { kind: "http", method: verb, path },
          tags: Array.isArray(source.tags) ? source.tags.map(String) : [],
          parameters,
          effect: EFFECT_BY_METHOD[verb],
          source: { location: pointer },
        }
        const security = this.security(source.security, `${pointer}.security`)
        if (security) operation.security = security
        if (typeof source.summary === "string") operation.summary = source.summary
        if (typeof source.description === "string") operation.description = source.description
        if (source.deprecated === true) operation.deprecated = true
        if (isObject(source.requestBody)) operation.requestBody = this.#requestBody(source.requestBody, pointer)
        const response = this.#response(source, pointer)
        if (response) operation.response = response
        operations.push(operation)
      }
    }
    return operations
  }
}

/** Throws `OpenApiError` with every problem at once, so one run shows all a spec update broke. */
export const adaptOpenApi = (
  document: unknown,
  source: { sourceUrl?: string; sourceRevision?: string } = {},
): ApiModel => {
  if (!isObject(document) || typeof document.openapi !== "string" || !document.openapi.startsWith("3.")) {
    throw new OpenApiError(["not an OpenAPI 3.x document"])
  }
  const adapter = new Adapter(document)
  const schemas = adapter.components()
  const operations = adapter.operations()
  // Meta's spec repeats one server on every path group.
  const servers = adapter
    .servers()
    ?.filter((one, index, all) => all.findIndex((other) => other.url === one.url) === index)
  const securitySchemes = adapter.securitySchemes()
  const security = adapter.security(document.security, "#/security")
  if (operations.length === 0) adapter.problems.push("the document has no operations")
  if (adapter.problems.length > 0) throw new OpenApiError(adapter.problems)
  const info = isObject(document.info) ? document.info : {}
  return {
    source: { kind: "openapi", ...(typeof info.version === "string" ? { version: info.version } : {}), ...source },
    schemas,
    operations,
    ...(servers?.length ? { servers } : {}),
    ...(securitySchemes ? { securitySchemes } : {}),
    ...(security ? { security } : {}),
  }
}
