import { appendFileSync } from "node:fs"
import type { Logger } from "./logger.js"
import { isContentKey, LOG_ATTRIBUTE_KEYS, type LogRecord, type LogSeverity } from "./standards/log.js"

/**
 * Field names whose value must never reach a log file. This is the **second** line of defence, not
 * the first: a secret should not be handed to a logger at all. Redaction catches the one that
 * slipped into a nested object nobody thought about.
 */
export const REDACTED_FIELDS = [
  "authorization",
  "Authorization",
  "apiKey",
  "api_key",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "password",
  "secret",
  "verifyCode",
  "verify_code",
  "phone",
]

export interface RecordLogOptions {
  /** A file the JSON lines are appended to, or a function handed each line. Omit for a log that writes nowhere. */
  to?: string | ((line: string) => void)
  runId: string
  command: string
  resource: LogRecord["resource"]
  traceId?: string
  /** Added to `REDACTED_FIELDS` — the names only this program knows about. */
  redact?: string[]
  /** Attribute keys this program logs beyond `LOG_ATTRIBUTE_KEYS`. Any other top-level key is written as `[not allowed]`. */
  allow?: readonly string[]
  /**
   * Told once when the file cannot be written; every record after that is dropped. Without it the
   * failure is silent, so a host that promised a log should say it is gone.
   */
  onError?: (error: Error) => void
  now?: () => Date
}

export const NOT_ALLOWED = "[not allowed]"

export interface RecordInput {
  severity: LogSeverity
  /** The attributes; its `event` names the record when there is no `message`. */
  event: object
  message?: string
  time: string
  runId: string
  traceId?: string
  command: string
  resource: LogRecord["resource"]
  allow?: readonly string[]
  redact?: readonly string[]
}

/**
 * The one place a record is built, for `createRecordLog` and for a writer that appends its own lines.
 * A top-level key off the allow-list keeps its name and loses its value; a key that names content
 * (`isContentKey`) or a secret is redacted at any depth.
 */
export const logRecordOf = ({
  severity,
  event,
  message,
  time,
  runId,
  traceId,
  command,
  resource,
  allow = [],
  redact = [],
}: RecordInput): LogRecord => {
  const allowed = new Set<string>([...LOG_ATTRIBUTE_KEYS, ...allow])
  const hidden = new Set([...REDACTED_FIELDS, ...redact])
  const attributes = Object.fromEntries(
    Object.entries(redacted(event, hidden) as Record<string, unknown>).map(([key, value]) => [
      key,
      allowed.has(key) ? value : NOT_ALLOWED,
    ]),
  )
  const name = typeof attributes.event === "string" ? attributes.event : ""
  return {
    time,
    severity,
    body: message ?? name,
    run_id: runId,
    ...(traceId === undefined ? {} : { trace_id: traceId }),
    command,
    attributes,
    resource,
  }
}

/**
 * One `LogRecord` per line, flat — never OTLP's nested export format.
 * The event becomes `attributes`; `body` is the message when one is given, else the event's own
 * `event` name, so it never needs content to say what happened.
 *
 * Appended synchronously: a log exists to explain the exit that would have dropped a buffered tail.
 */
export const createRecordLog = ({
  to,
  runId,
  command,
  resource,
  traceId,
  redact = [],
  allow = [],
  onError = () => {},
  now = () => new Date(),
}: RecordLogOptions): Logger => {
  if (to === undefined) return silent

  let broken = false
  const write =
    typeof to === "string"
      ? (line: string) => {
          if (broken) return
          try {
            appendFileSync(to, line, { mode: 0o600 })
          } catch (error) {
            broken = true
            onError(error instanceof Error ? error : new Error(String(error)))
          }
        }
      : (line: string) => to(line.trimEnd())

  const at =
    (severity: LogSeverity) =>
    (event: object, message?: string): void => {
      const record = logRecordOf({
        severity,
        event,
        ...(message === undefined ? {} : { message }),
        time: now().toISOString(),
        runId,
        ...(traceId === undefined ? {} : { traceId }),
        command,
        resource,
        allow,
        redact,
      })
      write(`${JSON.stringify(record)}\n`)
    }

  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") }
}

const redacted = (value: unknown, hidden: Set<string>): unknown => {
  const plain =
    value !== null && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function"
      ? (value.toJSON() as unknown)
      : value
  if (Array.isArray(plain)) return plain.map((item) => redacted(item, hidden))
  if (plain === null || typeof plain !== "object") return plain
  return Object.fromEntries(
    Object.entries(plain).map(([key, item]) => [
      key,
      hidden.has(key) || isContentKey(key) ? "[redacted]" : redacted(item, hidden),
    ]),
  )
}

const silent: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}
