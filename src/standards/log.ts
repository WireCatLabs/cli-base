import * as v from "valibot"
import { isoTime } from "./output.js"
import { text } from "./registry.js"

/** Upper-cased, these are OpenTelemetry's SeverityText values. */
export const LOG_SEVERITIES = ["trace", "debug", "info", "warn", "error", "fatal"] as const

/**
 * One log record, one flat JSON line. `time`, `severity`, `body`, `attributes`, `resource` and `trace_id` are
 * OpenTelemetry's names, `trace_id` as its trace-context spec spells it for JSON lines
 * (https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/); `run_id` and `command` are ours.
 */
export const logRecordSchema = v.strictObject({
  time: isoTime,
  severity: v.picklist(LOG_SEVERITIES),
  body: v.string(),
  run_id: text,
  /** From an MCP caller's `_meta.traceparent`, when it sent one. */
  trace_id: v.optional(v.pipe(v.string(), v.regex(/^[0-9a-f]{32}$/, "32 lower-case hex digits"))),
  command: v.string(),
  attributes: v.record(v.string(), v.unknown()),
  resource: v.strictObject({ service: text, version: text }),
})

export type LogRecord = v.InferOutput<typeof logRecordSchema>
export type LogSeverity = (typeof LOG_SEVERITIES)[number]

/** Attribute keys every program may log; a program adds its own with `allow`. Keys are camelCase until §3.9 reaches logs. */
export const LOG_ATTRIBUTE_KEYS = [
  "code",
  "count",
  "durationMs",
  "errorClass",
  "errorCode",
  "event",
  "frames",
  "operation",
  "outcome",
  "reason",
  "status",
] as const

/** A key carrying one of these words holds content or a secret, wherever the word sits: `chatTitle`, `accessToken`. */
const CONTENT_WORDS = new Set([
  "authorization",
  "body",
  "caption",
  "content",
  "cookie",
  "credential",
  "credentials",
  "email",
  "password",
  "phone",
  "query",
  "secret",
  "text",
  "title",
  "token",
])

/** Only as the last word: `errorMessage` and `firstName` are content, `messageId` and `nameServer` are not. */
const CONTENT_LAST_WORDS = new Set(["message", "name"])

const wordsOf = (key: string): string[] =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())

/** Whether a log attribute key names message text, a token, a phone number or another person's words. */
export const isContentKey = (key: string): boolean => {
  const words = wordsOf(key)
  return words.some((word) => CONTENT_WORDS.has(word)) || CONTENT_LAST_WORDS.has(words.at(-1) ?? "")
}

/** The allow-list as a JSON Schema, for `cli-dev lint --schemas` under the name `log_attributes`. */
export const logAttributesJsonSchema = (allow: readonly string[] = []): Record<string, unknown> => ({
  type: "object",
  properties: Object.fromEntries([...new Set([...LOG_ATTRIBUTE_KEYS, ...allow])].sort().map((key) => [key, {}])),
  additionalProperties: false,
})

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/

/**
 * The trace id of a W3C `traceparent` (https://www.w3.org/TR/trace-context/#traceparent-header), or undefined
 * for anything the spec says to ignore: version `ff`, an all-zero id, extra fields on version `00`.
 */
export const traceIdOf = (traceparent: unknown): string | undefined => {
  if (typeof traceparent !== "string") return undefined
  const match = TRACEPARENT.exec(traceparent.trim())
  if (!match) return undefined
  const [, version, traceId = "", parentId = "", , rest] = match
  if (version === "ff" || (version === "00" && rest !== undefined)) return undefined
  if (/^0+$/.test(traceId) || /^0+$/.test(parentId)) return undefined
  return traceId
}
