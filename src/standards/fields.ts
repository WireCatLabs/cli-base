import * as v from "valibot"
import { duplicates, parseRegistry, text, word } from "./registry.js"

const fieldRuleSchema = v.strictObject({ id: word, rule: text })
export type FieldRule = v.InferOutput<typeof fieldRuleSchema>

export const defineFieldRules = (input: unknown): FieldRule[] =>
  parseRegistry("output field rules", v.array(fieldRuleSchema), input, (rules) =>
    duplicates(rules.map((rule) => rule.id)).map((id) => `"${id}" is listed twice`),
  )

export const FIELD_RULES: FieldRule[] = defineFieldRules([
  { id: "envelope", rule: "every JSON answer is one object: a list `{items, page, …}`, one thing `{item, …}`" },
  { id: "time", rule: "a time is an ISO 8601 string in UTC, ending in `Z`, never epoch milliseconds" },
  { id: "duration", rule: "a length of time is a number of milliseconds in a key ending in `_ms`" },
  { id: "ref", rule: "a stored thing is named by `ref`; a message's `ref` value is its locator" },
  { id: "snake-case", rule: "keys are snake_case words, no abbreviations a reader has to decode" },
  { id: "one-meaning", rule: "a key has one meaning and one type in every answer of every CLI" },
  {
    id: "absent-null",
    rule: "absent: not asked for or not known; `null`: known to have no value; `[]`: known to be empty, never `null`; `0`: measured, never a stand-in for unknown",
  },
])
