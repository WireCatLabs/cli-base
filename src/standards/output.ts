import * as v from "valibot"
import { errorCodes } from "../errors.js"
import { dottedId, text } from "./registry.js"

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
    /**
     * The whole line to type, with the tool and the profile it ran with: `tg personal mcp config`. Only the CLI
     * knows the profile, so it fills this; MCP answers leave it out.
     */
    line: v.optional(text),
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
  /** Left out when there is nothing to run that would fill the field. */
  step: v.optional(dottedId),
})

const limit = v.pipe(v.number(), v.integer(), v.minValue(1))

/** `has_more`: another page exists. A cursor source never pretends to have page numbers. */
export const pageSchema = v.variant("mode", [
  v.strictObject({
    mode: v.literal("page"),
    limit,
    has_more: v.boolean(),
    next_page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(2))),
  }),
  v.strictObject({ mode: v.literal("cursor"), limit, has_more: v.boolean(), next_cursor: v.optional(text) }),
])

/** A source that failed or was skipped: the answer holds what the others gave. */
export const issueSchema = v.strictObject({
  code: v.picklist(errorCodes),
  reason: v.optional(dottedId),
  /** The account, provider or source that is missing from the answer. */
  source: text,
})

/**
 * `complete: false` (with `issues`): some source failed or was skipped. `truncated`: a size cap cut the answer.
 * Neither is `page.has_more`.
 */
export const metaSchema = v.strictObject({
  run_id: text,
  duration_ms: v.pipe(v.number(), v.integer(), v.minValue(0)),
  accounts: v.optional(v.array(text)),
  complete: v.boolean(),
  issues: v.optional(v.array(issueSchema)),
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
export type Issue = v.InferOutput<typeof issueSchema>
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

/** `--jsonl`: one item per line, then one end line, so a reader tells a finished stream from a cut one. */
export const jsonlItemSchema = <T extends v.GenericSchema>(item: T) =>
  v.strictObject({ type: v.literal("item"), data: item })

export const jsonlEndSchema = v.strictObject({
  type: v.literal("end"),
  complete: v.boolean(),
  issues: v.optional(v.array(issueSchema)),
  page: pageSchema,
})

/** A list answer as JSON lines, the end line last. */
export const jsonlOf = <T>({ items, page, meta }: ListEnvelope<T>): string =>
  [
    ...items.map((data) => JSON.stringify({ type: "item", data })),
    JSON.stringify({ type: "end", complete: meta.complete, ...(meta.issues ? { issues: meta.issues } : {}), page }),
  ].join("\n")
