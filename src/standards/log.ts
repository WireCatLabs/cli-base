import * as v from "valibot"
import { isoTime } from "./output.js"
import { text } from "./registry.js"

/** pino's level names, so a record maps to OpenTelemetry's SeverityText by upper-casing it. */
export const LOG_SEVERITIES = ["trace", "debug", "info", "warn", "error", "fatal"] as const

/** One log record, OpenTelemetry's field names, one flat JSON line. */
export const logRecordSchema = v.strictObject({
  time: isoTime,
  severity: v.picklist(LOG_SEVERITIES),
  body: v.string(),
  runId: text,
  /** From an MCP caller's `_meta.traceparent`, when it sent one. */
  traceId: v.optional(v.pipe(v.string(), v.regex(/^[0-9a-f]{32}$/, "32 lower-case hex digits"))),
  command: v.string(),
  attributes: v.record(v.string(), v.unknown()),
  resource: v.strictObject({ service: text, version: text }),
})

export type LogRecord = v.InferOutput<typeof logRecordSchema>
export type LogSeverity = (typeof LOG_SEVERITIES)[number]
