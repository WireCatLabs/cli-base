import { appendFileSync } from "node:fs"
import type { Logger } from "./logger.js"
import type { LogRecord, LogSeverity } from "./standards/log.js"

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
  /**
   * Told once when the file cannot be written; every record after that is dropped. Without it the
   * failure is silent, so a host that promised a log should say it is gone.
   */
  onError?: (error: Error) => void
  now?: () => Date
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
  onError = () => {},
  now = () => new Date(),
}: RecordLogOptions): Logger => {
  if (to === undefined) return silent

  const hidden = new Set([...REDACTED_FIELDS, ...redact])
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
      const attributes = redacted(event, hidden) as Record<string, unknown>
      const name = typeof attributes.event === "string" ? attributes.event : ""
      const record: LogRecord = {
        time: now().toISOString(),
        severity,
        body: message ?? name,
        run_id: runId,
        ...(traceId === undefined ? {} : { trace_id: traceId }),
        command,
        attributes,
        resource,
      }
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
    Object.entries(plain).map(([key, item]) => [key, hidden.has(key) ? "[redacted]" : redacted(item, hidden)]),
  )
}

const silent: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}
