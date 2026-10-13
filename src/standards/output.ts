import * as v from "valibot"
import { dottedId, duplicates, parseRegistry, text, word } from "./registry.js"

/** At most three next steps per answer, the most useful first. */
export const MAX_NEXT_STEPS = 3

export const isoTime = v.pipe(v.string(), v.isoTimestamp("an ISO 8601 time with a zone"))

export const nextStepSchema = v.strictObject({
  step: dottedId,
  /** The command path as one string, `messages list` — what the MCP router tools take as `command`. */
  command: text,
  args: v.record(v.string(), v.unknown()),
  why: text,
})

export const missingSchema = v.strictObject({
  field: text,
  why: text,
  step: dottedId,
})

export const pageSchema = v.strictObject({
  limit: v.pipe(v.number(), v.integer(), v.minValue(1)),
  hasMore: v.boolean(),
  cursor: v.optional(text),
})

export const metaSchema = v.strictObject({
  runId: text,
  durationMs: v.pipe(v.number(), v.integer(), v.minValue(0)),
  accounts: v.optional(v.array(text)),
  skipped: v.optional(v.array(v.strictObject({ account: text, why: text }))),
  truncated: v.optional(v.boolean()),
})

const nextSteps = v.optional(v.pipe(v.array(nextStepSchema), v.maxLength(MAX_NEXT_STEPS)))

export const listEnvelopeSchema = <T extends v.GenericSchema>(item: T) =>
  v.strictObject({
    items: v.array(item),
    page: pageSchema,
    next: nextSteps,
    missing: v.optional(v.array(missingSchema)),
    meta: metaSchema,
  })

export const itemEnvelopeSchema = <T extends v.GenericSchema>(item: T) =>
  v.strictObject({
    item,
    next: nextSteps,
    missing: v.optional(v.array(missingSchema)),
    meta: metaSchema,
  })

export type NextStep = v.InferOutput<typeof nextStepSchema>
export type Missing = v.InferOutput<typeof missingSchema>
export type Page = v.InferOutput<typeof pageSchema>
export type Meta = v.InferOutput<typeof metaSchema>
export interface ListEnvelope<T> {
  items: T[]
  page: Page
  next?: NextStep[]
  missing?: Missing[]
  meta: Meta
}
export interface ItemEnvelope<T> {
  item: T
  next?: NextStep[]
  missing?: Missing[]
  meta: Meta
}

const fieldRuleSchema = v.strictObject({ id: word, rule: text })
export type FieldRule = v.InferOutput<typeof fieldRuleSchema>

export const defineFieldRules = (input: unknown): FieldRule[] =>
  parseRegistry("output field rules", v.array(fieldRuleSchema), input, (rules) =>
    duplicates(rules.map((rule) => rule.id)).map((id) => `"${id}" is listed twice`),
  )

export const FIELD_RULES: FieldRule[] = defineFieldRules([
  { id: "envelope", rule: "every JSON answer is one object: a list `{items, page, …}`, one thing `{item, …}`" },
  { id: "time", rule: "a time is an ISO 8601 string with a zone, never epoch milliseconds" },
  { id: "duration", rule: "a length of time is a number of milliseconds in a field ending in `Ms`" },
  { id: "ref", rule: "a stored thing is named by `ref`; a message's `ref` value is its locator" },
  { id: "camel-case", rule: "keys are camelCase words, no abbreviations a reader has to decode" },
  { id: "one-meaning", rule: "a key has one meaning and one type in every answer of every CLI" },
])
