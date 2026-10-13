/**
 * Every failure a CLI built on this package, and anything consuming its output, can see. The list
 * is closed on purpose: an agent branches on `code`, and a new code is a contract change.
 *
 * "provider" is whatever the CLI talks to — an HTTP API, a socket, a messenger. The word is
 * deliberately not "server": a provider that answered with a refusal is not the same as one that
 * never answered.
 */
export const errorCodes = [
  "validation_error",
  "configuration_error",
  "authentication_error",
  "permission_error",
  "not_found",
  "confirmation_required",
  "rate_limited",
  "timeout",
  "network_error",
  "provider_error",
  "provider_unavailable",
  "invalid_response",
  "outcome_unknown",
  "cancelled",
] as const

export type ErrorCode = (typeof errorCodes)[number]

/**
 * Anything a caller may attach. Everything is optional because these are diagnostics, not a
 * contract — the contract is `code`.
 *
 * `retryable` says whether **this** failure could be retried, not whether the operation is safe to
 * retry. Those are different questions and conflating them is how a duplicate write happens.
 */
export interface CliErrorDetails {
  // Keys are the error object's `details` keys, so snake_case like every JSON key.
  readonly status?: number
  readonly retryable?: boolean
  readonly attempts?: number
  readonly request_id?: string
  readonly run_id?: string
  readonly retry_after_ms?: number
  readonly operation?: string
  /** A registered reason, `store.locked`; recovery is chosen by it and the code, never by the message. */
  readonly reason?: string
  /** The option or argument at fault. */
  readonly param?: string
  readonly [key: string]: unknown
}

// Symbol.for, so two copies of this package — one CLI's and one dependency's, during a pin bump —
// recognise each other's errors where `instanceof` cannot.
const BRAND = Symbol.for("@wirecat/cli-base/CliError")

export class CliError extends Error {
  readonly code: ErrorCode
  readonly details: CliErrorDetails

  constructor(code: ErrorCode, message: string, details: CliErrorDetails = {}) {
    super(message)
    this.name = "CliError"
    this.code = code
    this.details = details
    Object.defineProperty(this, BRAND, { value: true })
  }
}

export const isCliError = (value: unknown): value is CliError =>
  typeof value === "object" && value !== null && (value as { [BRAND]?: unknown })[BRAND] === true
