import * as v from "valibot"
import { errorCodes } from "../errors.js"
import { MAX_NEXT_STEPS, nextStepSchema } from "./output.js"
import { dottedId, duplicates, parseRegistry, placeholders, text } from "./registry.js"

/** The one error object, on stderr in machine mode and as MCP's `isError` content alike. */
export const errorObjectSchema = v.strictObject({
  error: v.strictObject({
    code: v.picklist(errorCodes),
    reason: dottedId,
    message: text,
    /** The option or argument at fault. */
    param: v.optional(text),
    details: v.optional(v.record(v.string(), v.unknown())),
    next: v.optional(v.pipe(v.array(nextStepSchema), v.maxLength(MAX_NEXT_STEPS))),
    runId: text,
  }),
})

export type ErrorObject = v.InferOutput<typeof errorObjectSchema>

const reasonSchema = v.strictObject({
  reason: dottedId,
  code: v.picklist(errorCodes),
  /** `{name}` placeholders, each one of `details`. */
  message: v.pipe(text, v.maxLength(120)),
  details: v.array(v.pipe(v.string(), v.regex(/^[a-z][a-zA-Z0-9]*$/, "a camelCase key"))),
  step: v.optional(dottedId),
})

export type ErrorReason = v.InferOutput<typeof reasonSchema>

/** Reasons live where they are raised; each package defines its own list with this. */
export const defineReasons = (input: unknown): ErrorReason[] =>
  parseRegistry("error reasons", v.array(reasonSchema), input, (reasons) => [
    ...duplicates(reasons.map((entry) => entry.reason)).map((reason) => `"${reason}" is listed twice`),
    ...reasons.flatMap((entry) =>
      placeholders(entry.message)
        .filter((name) => !entry.details.includes(name))
        .map((name) => `${entry.reason}: the message names {${name}}, which is not one of its details`),
    ),
  ])
