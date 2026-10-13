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
