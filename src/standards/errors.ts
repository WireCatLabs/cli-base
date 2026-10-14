import * as v from "valibot"
import { errorCodes } from "../errors.js"
import { MAX_NEXT_STEPS, nextStepSchema } from "./output.js"
import { dottedId, duplicates, parseRegistry, placeholders, SNAKE_CASE, text } from "./registry.js"

/**
 * What a failure that is not a `CliError` reports: a bug, not a refusal. Outside `errorCodes` on purpose,
 * so no command can raise it; it exits with `GENERIC_FAILURE`.
 */
export const CRASH_CODE = "internal_error"
export const CRASH_REASON = "command.crashed"

/** The one error object, on stderr in machine mode and as MCP's `isError` content alike. */
export const errorObjectSchema = v.strictObject({
  error: v.strictObject({
    code: v.picklist([...errorCodes, CRASH_CODE]),
    reason: dottedId,
    message: text,
    /** The option or argument at fault. */
    param: v.optional(text),
    details: v.optional(v.record(v.string(), v.unknown())),
    next: v.optional(v.pipe(v.array(nextStepSchema), v.maxLength(MAX_NEXT_STEPS))),
    /** Whether running the same command again may work and cannot do harm; never for a write that may have landed. */
    retry: v.strictObject({
      safe: v.boolean(),
      after_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    }),
    /** Optional until every CLI keeps a run for each failure. */
    run_id: v.optional(text),
  }),
})

export type ErrorObject = v.InferOutput<typeof errorObjectSchema>

const reasonSchema = v.strictObject({
  reason: dottedId,
  code: v.picklist([...errorCodes, CRASH_CODE]),
  /** `{name}` placeholders, each one of `details`. */
  message: v.pipe(text, v.maxLength(120)),
  details: v.array(v.pipe(v.string(), v.regex(SNAKE_CASE, "a snake_case key"))),
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

/**
 * Keys any reason's `details` may carry; the handler drops every other key it was not told about. `retryable`,
 * `retry_after_ms` and `sent` are read into `retry`, not repeated here.
 */
export const COMMON_DETAILS = ["attempts", "status", "request_id", "operation", "operation_id"] as const

/** One reason per code, used when the code site named none, the crash, and the reasons cli-base raises itself. */
export const BASE_REASONS: ErrorReason[] = defineReasons([
  { reason: "input.invalid", code: "validation_error", message: "the input is not valid", details: [] },
  { reason: "config.invalid", code: "configuration_error", message: "the configuration is not valid", details: [] },
  { reason: "auth.failed", code: "authentication_error", message: "the sign-in did not work", details: [] },
  { reason: "access.denied", code: "permission_error", message: "this account may not do that", details: [] },
  { reason: "item.not-found", code: "not_found", message: "nothing found by that name", details: [] },
  {
    reason: "confirmation.required",
    code: "confirmation_required",
    message: "this changes something; confirm it",
    details: [],
  },
  { reason: "provider.rate-limited", code: "rate_limited", message: "too many requests; wait", details: [] },
  { reason: "command.timed-out", code: "timeout", message: "the command took too long", details: ["timeout_ms"] },
  { reason: "network.failed", code: "network_error", message: "the network did not answer", details: [] },
  { reason: "provider.refused", code: "provider_error", message: "the provider refused", details: [] },
  { reason: "provider.unavailable", code: "provider_unavailable", message: "the provider is down", details: [] },
  {
    reason: "provider.invalid-response",
    code: "invalid_response",
    message: "the answer could not be read",
    details: [],
  },
  {
    reason: "output.too-large",
    code: "invalid_response",
    message: "the output is over {max_bytes} bytes",
    details: ["max_bytes", "buffered_bytes", "partial_output"],
  },
  {
    reason: "output.fields-unavailable",
    code: "invalid_response",
    message: "fields can be picked only from whole JSON values",
    details: [],
  },
  { reason: "outcome.unknown", code: "outcome_unknown", message: "it is not known whether it worked", details: [] },
  { reason: "command.cancelled", code: "cancelled", message: "the command was cancelled", details: [] },
  { reason: CRASH_REASON, code: CRASH_CODE, message: "the command failed; this is a bug", details: [] },
])
