import * as v from "valibot"
import { errorCodes } from "../errors.js"
import { dottedId, text } from "./registry.js"

/** At most two next steps per answer: the one to take, then one alternative. */
export const MAX_NEXT_STEPS = 2

/** The switch for one line per item (WC-OUT-24). Its name is still the owner's to settle, so it lives in one place. */
export const COMPACT_FLAG = "--compact"

export const isoTime = v.pipe(
  v.string(),
  v.isoTimestamp("an ISO 8601 time in UTC"),
  v.endsWith("Z", "an ISO 8601 time in UTC, ending in `Z`"),
)

/** The same moment on the wall clock of a zone, with its offset: `2026-11-02T16:03:00.000+01:00` (WC-TIME-2). */
export const localTime = v.pipe(
  v.string(),
  v.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/, "an ISO 8601 time with its offset"),
)

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

/**
 * How many match, every page together, as Elasticsearch's `hits.total`: `eq` is the exact count, `gte` a lower bound
 * (counting stopped at a cap, or could not be done cheaply).
 */
export const totalSchema = v.strictObject({
  value: v.pipe(v.number(), v.integer(), v.minValue(0)),
  relation: v.picklist(["eq", "gte"]),
})

/** `has_more`: another page exists. A cursor source never pretends to have page numbers. */
export const pageSchema = v.variant("mode", [
  v.strictObject({
    mode: v.literal("page"),
    limit,
    has_more: v.boolean(),
    next_page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(2))),
    total: v.optional(totalSchema),
  }),
  v.strictObject({
    mode: v.literal("cursor"),
    limit,
    has_more: v.boolean(),
    next_cursor: v.optional(text),
    total: v.optional(totalSchema),
  }),
])

export type Total = v.InferOutput<typeof totalSchema>

/**
 * A list or search returned by a TypeScript API (WC-OUT-25). It pages by `offset` and `limit`; a source with its own
 * position gives `nextCursor` instead. `--json` prints it as the list envelope, in snake_case.
 */
export interface ListResult<T> {
  items: T[]
  hasMore: boolean
  /** The `offset` that reads the next page; absent on the last one. */
  nextOffset?: number
  nextCursor?: string
  total?: Total
}

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
/**
 * What a hosted model did to the order of a search's hits (memo's `search all --harder`): `applied` when its order
 * replaced the plain one, else `reason_id` says why. `cost_usd` is null for a model with no known price.
 */
export const rankingSchema = v.strictObject({
  applied: v.boolean(),
  reason_id: v.optional(dottedId),
  provider: text,
  model: text,
  endpoint: text,
  sent: v.pipe(v.number(), v.integer(), v.minValue(0)),
  cost_usd: v.nullable(v.pipe(v.number(), v.minValue(0))),
  usage: v.optional(
    v.strictObject({
      input: v.pipe(v.number(), v.integer(), v.minValue(0)),
      output: v.pipe(v.number(), v.integer(), v.minValue(0)),
    }),
  ),
  ms: v.pipe(v.number(), v.integer(), v.minValue(0)),
})

export const metaSchema = v.strictObject({
  run_id: text,
  duration_ms: v.pipe(v.number(), v.integer(), v.minValue(0)),
  accounts: v.optional(v.array(text)),
  complete: v.boolean(),
  issues: v.optional(v.array(issueSchema)),
  truncated: v.optional(v.boolean()),
  timezone: v.optional(text),
  /** When the command answered, for an agent that plans from "now" (WC-TIME-7); `timezone` names the zone of `now_local`. */
  now: v.optional(isoTime),
  now_local: v.optional(localTime),
  window: v.optional(v.strictObject({ since: v.optional(isoTime), until: v.optional(isoTime) })),
  ranking: v.optional(rankingSchema),
})

const offsetOf = (at: number, zone: string): string => {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT"
  return name === "GMT" ? "+00:00" : name.slice(3)
}

/**
 * `meta.now`, `meta.now_local` and `meta.timezone` for an answer an agent plans by (WC-TIME-7): the moment in UTC, the
 * same moment on the zone's wall clock, and the zone.
 */
export const clockMeta = (at: number, zone: string): { now: string; now_local: string; timezone: string } => {
  const offset = offsetOf(at, zone)
  const sign = offset.startsWith("-") ? -1 : 1
  const [hours = 0, minutes = 0] = offset.slice(1).split(":").map(Number)
  const wall = new Date(at + sign * (hours * 60 + minutes) * 60_000).toISOString().slice(0, -1)
  return { now: new Date(at).toISOString(), now_local: `${wall}${offset}`, timezone: zone }
}

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
export type Ranking = v.InferOutput<typeof rankingSchema>
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
