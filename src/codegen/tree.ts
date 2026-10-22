import type { ApiModel, ApiSchema, SchemaNode } from "./model.js"
import { identifier } from "./names.js"
import { CodegenError } from "./pipeline.js"

type ObjectNode = Extract<SchemaNode, { type: "object" }>

/** The values a subtype's discriminator property may hold: one per mapping entry that selects it. */
export interface Literal {
  property: string
  values: readonly string[]
}

export interface NamedSchema {
  name: string
  schema: ApiSchema
}

/**
 * The schema index generators share: named components, inline request and response bodies given a
 * name of their own, and which subtype each discriminator value selects.
 */
export class SchemaTree {
  readonly named: NamedSchema[]
  readonly #byId: Map<string, ApiSchema>
  readonly #literals = new Map<string, Literal>()
  readonly #requests = new Map<string, string>()
  readonly #responses = new Map<string, string>()

  constructor(model: ApiModel) {
    this.#byId = new Map(model.schemas.map((schema) => [schema.id, schema]))
    this.named = model.schemas.map((schema) => ({ name: identifier(schema.id), schema }))

    const taken = new Set(this.named.map((entry) => entry.name))
    const nameInline = (operationId: string, suffix: string, node: SchemaNode | undefined): string | undefined => {
      if (!node) return undefined
      if (node.type === "ref") return identifier(node.ref)
      const name = identifier(`${operationId} ${suffix}`)
      if (taken.has(name))
        throw new CodegenError([`inline ${suffix.toLowerCase()} of "${operationId}" collides with ${name}`])
      taken.add(name)
      this.named.push({ name, schema: { id: name, schema: node } })
      return name
    }
    for (const operation of model.operations) {
      const request = nameInline(operation.id, "Request", operation.requestBody?.schema)
      const response = nameInline(operation.id, "Response", operation.response?.schema)
      if (request) this.#requests.set(operation.id, request)
      if (response) this.#responses.set(operation.id, response)
    }

    for (const schema of model.schemas) {
      for (const [value, target] of Object.entries(schema.discriminator?.mapping ?? {})) {
        const property = schema.discriminator?.property ?? ""
        const known = this.#literals.get(target)
        // Two bases may share a subtype when both choose it by the same property, as Meta's sent and received messages do.
        if (known && known.property !== property) {
          throw new CodegenError([
            `schema "${target}" is a subtype chosen by both "${known.property}" and "${property}"`,
          ])
        }
        const values = known?.values ?? []
        this.#literals.set(target, { property, values: values.includes(value) ? values : [...values, value] })
      }
    }
  }

  schema(id: string): ApiSchema {
    const schema = this.#byId.get(id)
    if (!schema) throw new CodegenError([`unknown schema "${id}"`])
    return schema
  }

  requestName(operationId: string): string | undefined {
    return this.#requests.get(operationId)
  }

  responseName(operationId: string): string | undefined {
    return this.#responses.get(operationId)
  }

  /** The values a subtype's discriminator property may hold, if the schema is a subtype. */
  literalFor(id: string): Literal | undefined {
    return this.#literals.get(id)
  }

  /** Merges inheritance into one object. A member that is not an object stops generation. */
  flatten(node: SchemaNode, where: string): ObjectNode {
    if (node.type === "object") return node
    if (node.type === "ref") return this.flatten(this.schema(node.ref).schema, `${where} → ${node.ref}`)
    if (node.type !== "allOf") {
      throw new CodegenError([`${where}: allOf member of type "${node.type}" cannot be merged into an object`])
    }
    const merged: { properties: Record<string, SchemaNode>; required: string[]; additionalProperties?: SchemaNode } = {
      properties: {},
      required: [],
    }
    for (const member of node.of) {
      const part = this.flatten(member, where)
      Object.assign(merged.properties, part.properties)
      for (const name of part.required) if (!merged.required.includes(name)) merged.required.push(name)
      if (part.additionalProperties) merged.additionalProperties = part.additionalProperties
    }
    return { type: "object", description: node.description, nullable: node.nullable, ...merged }
  }
}
