/**
 * An OpenAPI 3.0 or 3.1 document, already parsed from YAML or JSON → the format-neutral `ApiModel`.
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
  Effect,
  HttpMethod,
  SchemaNode,
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
]

export class OpenApiError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`the OpenAPI document cannot be adapted:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`)
    this.name = "OpenApiError"
    this.problems = problems
  }
}

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)

const EFFECT_BY_METHOD: Record<HttpMethod, Effect> = {
  GET: "read",
  HEAD: "read",
  POST: "write",
  PUT: "write",
  PATCH: "write",
  DELETE: "destructive",
}

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

    if (Array.isArray(source.allOf)) return this.#allOf(source, source.allOf, common, where)

    if (Array.isArray(source.oneOf)) {
      const of = source.oneOf.map((member, index) => this.schema(member, `${where}.oneOf[${index}]`))
      return { ...common, type: "union", of }
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

  #allOf(source: Json, members: unknown[], common: Common, where: string): SchemaNode {
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
    const type = carriesFile ? MULTIPART : [JSON_TYPE, MULTIPART, FORM].find((candidate) => offered.includes(candidate))
    const body: ApiBody = { confidence: "contract", required: source.required === true }
    if (offered.length === 0) return body
    if (!type) {
      this.problems.push(`${where}: a body must be JSON, multipart or a form, found ${offered.join(", ")}`)
      return body
    }
    if (type !== JSON_TYPE) body.contentType = type
    const schema = schemaOf(type)
    if (schema === undefined) return body
    if (typedFromExample(schema)) body.confidence = "example"
    body.schema = this.schema(schema, `${where}.requestBody`)
    return body
  }

  /**
   * Only an inline JSON answer has a shape to check; a file, plain text or a `$ref` to a shared response
   * is passed through as it is. Nothing at run time validates an answer yet.
   */
  #response(source: Json, where: string): SchemaNode | undefined {
    const ok = isObject(source.responses) ? source.responses["200"] : undefined
    if (!isObject(ok) || !isObject(ok.content)) return undefined
    const json = ok.content[JSON_TYPE]
    if (!isObject(json) || json.schema === undefined) return undefined
    return this.schema(json.schema, `${where}.responses.200`)
  }

  operations(): ApiOperation[] {
    const operations: ApiOperation[] = []
    const paths = isObject(this.document.paths) ? this.document.paths : {}
    for (const [path, item] of Object.entries(paths)) {
      if (!isObject(item)) continue
      const shared = Array.isArray(item.parameters) ? item.parameters : []
      for (const method of METHODS) {
        const source = item[method]
        if (!isObject(source)) continue
        const pointer = `#/paths/${path.replaceAll("~", "~0").replaceAll("/", "~1")}/${method}`
        // A path without an id is a description, not a call: Meta models its webhook payload this way.
        if (typeof source.operationId !== "string") continue
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
          id: source.operationId,
          binding: { kind: "http", method: verb, path },
          tags: Array.isArray(source.tags) ? source.tags.map(String) : [],
          parameters,
          effect: EFFECT_BY_METHOD[verb],
          source: { location: pointer },
        }
        if (typeof source.summary === "string") operation.summary = source.summary
        if (typeof source.description === "string") operation.description = source.description
        if (source.deprecated === true) operation.deprecated = true
        if (isObject(source.requestBody)) operation.requestBody = this.#requestBody(source.requestBody, pointer)
        const response = this.#response(source, pointer)
        if (response) operation.response = { confidence: "contract", required: true, schema: response }
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
  if (operations.length === 0) adapter.problems.push("the document has no operations")
  if (adapter.problems.length > 0) throw new OpenApiError(adapter.problems)
  const info = isObject(document.info) ? document.info : {}
  return {
    source: { kind: "openapi", ...(typeof info.version === "string" ? { version: info.version } : {}), ...source },
    schemas,
    operations,
  }
}
