import type { ManifestOperation } from "./manifest.js"
import type { SchemaNode } from "./model.js"
import { identifier } from "./names.js"

/**
 * The JSON Schema (draft 2020-12) of an operation's request body, built from the `definitions` that
 * `definitionsGenerator` wrote, with every referenced definition under `$defs`; `null` when the operation takes no
 * body. For a CLI's `api show`, so an agent sees what to send before it calls.
 */
export const requestSchema = (
  operation: Pick<ManifestOperation, "request">,
  definitions: Readonly<Record<string, SchemaNode>>,
): Record<string, unknown> | null => {
  if (!operation.request?.schema) return null
  const defs: Record<string, unknown> = {}
  const visiting = new Set<string>()
  const node = (value: SchemaNode): Record<string, unknown> => {
    const common = { ...(value.description ? { description: value.description } : {}) }
    switch (value.type) {
      case "ref": {
        const name = identifier(value.ref)
        add(name)
        return { ...common, $ref: `#/$defs/${name}` }
      }
      case "unknown":
        return common
      case "union":
        return { ...common, anyOf: value.of.map(node) }
      case "allOf":
        return { ...common, allOf: value.of.map(node) }
      case "object":
        return {
          ...common,
          type: "object",
          properties: Object.fromEntries(Object.entries(value.properties).map(([key, item]) => [key, node(item)])),
          required: value.required,
          additionalProperties: value.additionalProperties ? node(value.additionalProperties) : true,
        }
      case "array":
        return {
          ...common,
          type: "array",
          items: node(value.items),
          ...(value.minItems === undefined ? {} : { minItems: value.minItems }),
          ...(value.maxItems === undefined ? {} : { maxItems: value.maxItems }),
        }
      case "string":
        return {
          ...common,
          type: "string",
          ...(value.enum ? { enum: value.enum } : {}),
          ...(value.pattern ? { pattern: value.pattern } : {}),
          ...(value.minLength === undefined ? {} : { minLength: value.minLength }),
          ...(value.maxLength === undefined ? {} : { maxLength: value.maxLength }),
        }
      case "boolean":
        return { ...common, type: "boolean" }
      case "integer":
      case "number":
        return {
          ...common,
          type: value.type,
          ...(value.minimum === undefined ? {} : { minimum: value.minimum }),
          ...(value.maximum === undefined ? {} : { maximum: value.maximum }),
        }
    }
  }
  const add = (name: string) => {
    if (visiting.has(name)) return
    visiting.add(name)
    const value = definitions[name]
    if (!value) throw new Error(`generated schema reference is missing: ${name}`)
    defs[name] = node(value)
  }
  add(operation.request.schema)
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $ref: `#/$defs/${operation.request.schema}`,
    $defs: defs,
  }
}
