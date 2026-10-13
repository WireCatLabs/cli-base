import type * as v from "valibot"
import { reference } from "../standards/output.js"
import type { Operator, Predicate } from "./types.js"

/** kw a whole value · txt matched by words · enum one of `values` · num, time compared and ranged · bool · ref a typed name. */
export const FIELD_TYPES = ["kw", "txt", "enum", "num", "time", "bool", "ref"] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export const OPERATORS_BY_TYPE: Readonly<Record<FieldType, readonly Operator[]>> = {
  kw: ["term", "phrase", "wildcard"],
  txt: ["term", "phrase", "wildcard"],
  enum: ["term"],
  num: ["term", "range"],
  time: ["term", "range"],
  bool: ["term"],
  ref: ["term", "phrase"],
}

export interface FieldSpec {
  /** The entity's key, snake_case: `unread_count`. */
  name: string
  type: FieldType
  operators: readonly Operator[]
  values?: readonly string[]
  /** One whole term, `kind:group`; help shows it and lint checks that it parses. */
  example: string
  /** Not a key of the entity: what it reaches, in words — `the notes that mention it`, or an `is:` state. */
  relation?: string
  /** On a list whose source filters it (`backend: "native"`), true when the source can. */
  native?: boolean
  /** `and`: only as a required term, never under OR or NOT — what a relation compiled to a sub-select needs. */
  placement?: "and"
  /** Checks only this field needs; throw with `queryError`. */
  validate?: (node: Predicate) => void
}

/** Where a list's query is answered: its store (`sql`) or the provider (`native`). Nothing filters in memory. */
export const QUERY_BACKENDS = ["sql", "native"] as const
export type QueryBackend = (typeof QUERY_BACKENDS)[number]

export interface QueryRegistry {
  /** The entity the list answers with, as its schema is registered: `chat`. */
  entity: string
  backend: QueryBackend
  fields: readonly FieldSpec[]
  /** Terms that apply unless the query names their field: `state:open`. */
  defaults?: readonly string[]
}

export interface FieldAnnotations {
  /** Keys never filtered: `provider_metadata`. */
  exclude?: readonly string[]
  /** String keys matched by words rather than as one value. */
  text?: readonly string[]
  /** Fields that are not keys of the entity. */
  relations?: Readonly<
    Record<string, Pick<FieldSpec, "type" | "example" | "relation"> & Partial<Pick<FieldSpec, "values" | "placement">>>
  >
  /** `is:` values and what each means: `{ unanswered: "the last message is not mine" }`. */
  states?: Readonly<Record<string, string>>
  examples?: Readonly<Record<string, string>>
  /** On a native list, the keys the source filters. */
  native?: readonly string[]
  validate?: Readonly<Record<string, (node: Predicate) => void>>
}

type Schema = v.GenericSchema & {
  type: string
  wrapped?: Schema
  pipe?: readonly { type: string; requirement?: unknown }[]
  options?: readonly unknown[]
  item?: Schema
  entries?: Record<string, Schema>
}

const unwrap = (schema: Schema): Schema => (schema.wrapped ? unwrap(schema.wrapped) : schema)

const REFERENCE_SOURCE = (reference.pipe[1] as { requirement: RegExp }).requirement.source

const typeOf = (schema: Schema): Pick<FieldSpec, "type" | "values"> | undefined => {
  const plain = unwrap(schema)
  const actions = plain.pipe ?? []
  switch (plain.type) {
    case "picklist":
      return { type: "enum", values: (plain.options ?? []).map(String) }
    case "number":
      return { type: "num" }
    case "boolean":
      return { type: "bool" }
    case "string":
      if (actions.some((action) => action.type === "iso_timestamp")) return { type: "time" }
      if (
        actions.some((action) => action.requirement instanceof RegExp && action.requirement.source === REFERENCE_SOURCE)
      )
        return { type: "ref" }
      return { type: "kw" }
    case "array":
      return plain.item ? typeOf(plain.item) : undefined
    default:
      return undefined
  }
}

const exampleOf = (name: string, type: FieldType, values?: readonly string[]): string =>
  ({
    kw: `${name}:abc`,
    txt: `${name}:word*`,
    enum: `${name}:${values?.[0] ?? "x"}`,
    num: `${name}>0`,
    time: `${name}>=7d`,
    bool: `${name}:true`,
    ref: `${name}:"note:42"`,
  })[type]

/**
 * A list's fields from its entity's valibot schema: string → kw, picklist → enum, number → num, `isoTime` → time,
 * boolean → bool, `reference` → ref; an array takes its item's type. Objects and records are not fields.
 */
export const queryFieldsOf = (schema: v.GenericSchema, annotations: FieldAnnotations = {}): FieldSpec[] => {
  const entries = (unwrap(schema as Schema).entries ?? {}) as Record<string, Schema>
  const excluded = new Set(annotations.exclude ?? [])
  const words = new Set(annotations.text ?? [])
  const native = new Set(annotations.native ?? [])
  const finish = (field: Omit<FieldSpec, "operators" | "example"> & { example?: string }): FieldSpec => ({
    ...field,
    operators: OPERATORS_BY_TYPE[field.type],
    example: annotations.examples?.[field.name] ?? field.example ?? exampleOf(field.name, field.type, field.values),
    ...(native.has(field.name) ? { native: true } : {}),
    ...(annotations.validate?.[field.name] ? { validate: annotations.validate[field.name] } : {}),
  })
  const own = Object.entries(entries).flatMap(([name, entry]) => {
    if (excluded.has(name)) return []
    const found = typeOf(entry)
    if (!found) return []
    return [finish({ name, ...found, ...(words.has(name) && found.type === "kw" ? { type: "txt" as const } : {}) })]
  })
  const relations = Object.entries(annotations.relations ?? {}).map(([name, relation]) => finish({ name, ...relation }))
  const states = annotations.states
    ? [
        finish({
          name: "is",
          type: "enum",
          values: Object.keys(annotations.states),
          relation: Object.entries(annotations.states)
            .map(([state, meaning]) => `${state}: ${meaning}`)
            .join("; "),
        }),
      ]
    : []
  return [...own, ...relations, ...states]
}
