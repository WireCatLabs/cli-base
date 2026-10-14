import * as v from "valibot"
import { dottedId, duplicates, parseRegistry, text, word } from "./registry.js"

/** At most two next steps per answer: the one to take, then one alternative. */
export const MAX_NEXT_STEPS = 2

export const isoTime = v.pipe(v.string(), v.isoTimestamp("an ISO 8601 time with a zone"))

/** The typed name of a stored thing, `msg:telegram/1/2/3` or `note:42`: what every other command takes. */
export const reference = v.pipe(v.string(), v.regex(/^[a-z]+:\S+$/, "a reference such as `note:42`"))

export const nextStepSchema = v.variant("kind", [
  v.strictObject({
    kind: v.literal("command"),
    step: dottedId,
    /** The command path as one string, `messages list` — what the MCP router tools take as `command`. */
    command: text,
    args: v.record(v.string(), v.unknown()),
    why: text,
    /** True only when the target command is known to write nothing, here or at the provider. */
    safe_to_auto_execute: v.boolean(),
  }),
  /** Something only the person can do — sign in on the phone, approve a device. */
  v.strictObject({
    kind: v.literal("user_action"),
    step: dottedId,
    why: text,
    safe_to_auto_execute: v.literal(false),
  }),
])

export const missingSchema = v.strictObject({
  field: text,
  why: text,
  step: dottedId,
})

export const pageSchema = v.strictObject({
  limit: v.pipe(v.number(), v.integer(), v.minValue(1)),
  has_more: v.boolean(),
  cursor: v.optional(text),
})

export const metaSchema = v.strictObject({
  run_id: text,
  duration_ms: v.pipe(v.number(), v.integer(), v.minValue(0)),
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
  { id: "duration", rule: "a length of time is a number of milliseconds in a key ending in `_ms`" },
  { id: "ref", rule: "a stored thing is named by `ref`; a message's `ref` value is its locator" },
  { id: "snake-case", rule: "keys are snake_case words, no abbreviations a reader has to decode" },
  { id: "one-meaning", rule: "a key has one meaning and one type in every answer of every CLI" },
])
