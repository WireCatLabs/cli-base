import * as v from "valibot"
import { duplicates, parseRegistry, SNAKE_CASE, text } from "./registry.js"

const key = v.pipe(v.string(), v.regex(SNAKE_CASE, "a snake_case key"))

const identifierSchema = v.strictObject({ key, meaning: text, replaces: v.optional(v.array(key)) })

export type Identifier = v.InferOutput<typeof identifierSchema>

export const defineIdentifiers = (input: unknown): Identifier[] =>
  parseRegistry("identifiers", v.array(identifierSchema), input, (identifiers) => {
    const keys = identifiers.map((entry) => entry.key)
    const replaced = identifiers.flatMap((entry) => entry.replaces ?? [])
    return [
      ...duplicates([...keys, ...replaced]).map((name) => `"${name}" is listed twice`),
      ...replaced.filter((name) => keys.includes(name)).map((name) => `"${name}" is both a key and replaced`),
    ]
  })

/** The ids a CLI's answers, errors and logs carry; one name each. */
export const IDENTIFIERS: Identifier[] = defineIdentifiers([
  {
    key: "run_id",
    meaning: "one invocation of a command, what `runs show` opens",
    replaces: ["execution_id", "invocation_id", "log_id", "diagnostic_id"],
  },
  { key: "operation_id", meaning: "one logical write attempt; a retry of it reuses the id" },
  { key: "request_id", meaning: "the provider's own reference for one request, as it sent it" },
  { key: "trace_id", meaning: "the distributed trace a run belongs to, from `traceparent`" },
])
