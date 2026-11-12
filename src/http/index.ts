/**
 * The HTTP layer, deliberately behind its own entry point.
 *
 * A CLI that speaks a socket, a message bus or a local database has no business depending on
 * status-code semantics and `Retry-After` parsing. Import `@wirecat/cli-base/http` only when
 * the thing on the other end is actually HTTP.
 */
import { CliError, type ErrorCode, isCliError } from "../errors.js"
import { backoffMs, DEFAULT_RETRY, type RetryConfig } from "../retry.js"
import { realSleep, type SleepLike, type WallClock, wallClock } from "../time.js"

/** The one function an HTTP client needs from its environment. A Worker, a browser, a test and Node all satisfy it. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** `Retry-After` is either a number of seconds or an HTTP date. Both forms occur in the wild. */
export const parseRetryAfter = (header: string | null | undefined, now: WallClock): number | undefined => {
  if (!header) return undefined

  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000

  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return undefined

  const delta = at - now().getTime()
  // A date already in the past would otherwise become a zero wait, and a zero wait against a rate
  // limit is a hot loop.
  return delta > 0 ? delta : undefined
}

/** A Unix timestamp in seconds, the shape several providers use for `X-RateLimit-Reset`. */
export const parseRateLimitReset = (header: string | null | undefined, now: WallClock): number | undefined => {
  if (!header) return undefined

  const seconds = Number(header.trim())
  if (!Number.isFinite(seconds)) return undefined

  const delta = seconds * 1000 - now().getTime()
  return delta > 0 ? delta : undefined
}

/** What the provider asked us to wait, if it asked at all. Its timing beats our own backoff. */
export const providerWaitMs = (headers: Headers, now: WallClock): number | undefined =>
  parseRetryAfter(headers.get("retry-after"), now) ?? parseRateLimitReset(headers.get("x-ratelimit-reset"), now)

export const retryableStatus = (status: number): boolean => status === 408 || status === 429 || status >= 500

export const statusToCode = (status: number): ErrorCode => {
  if (status === 400 || status === 422) return "validation_error"
  if (status === 401) return "authentication_error"
  if (status === 403) return "permission_error"
  if (status === 404) return "not_found"
  if (status === 408) return "timeout"
  if (status === 429) return "rate_limited"
  if (status === 502 || status === 503 || status === 504) return "provider_unavailable"
  return "provider_error"
}

export { type JsonResponseOptions, readJsonResponse } from "./body.js"
export { HOST_FETCH_TIMEOUT_MS, type HostFetchOptions, hostFetch } from "./fetch.js"
export { HOST_PATTERN, hostCovered, hostProblems } from "./hosts.js"

/** cli-core's `Pacer` fits: one queue for every process of a profile, since a provider's limit is per account. */
export interface PacerLike {
  /** The epoch milliseconds at which this request may go. */
  reserve(): Promise<number>
  /** Everyone waits this long, because the provider said so. */
  holdFor(ms: number): Promise<void>
}

export interface RetryingOptions {
  retry?: RetryConfig
  /** Which requests may be sent again after a failure. A write is sent again only when the provider refused it (429). */
  reads?: (method: string, url: URL) => boolean
  pacer?: PacerLike
  /** The most the retries and pacing of one request may wait in all; more ends it with the last answer. */
  budget?: number
  sleep?: SleepLike
  now?: WallClock
  random?: () => number
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"])

/** `fetch` that waits and sends again: reads on a retryable status or error, writes only on 429. */
export const retrying = (send: FetchLike, options: RetryingOptions = {}): FetchLike => {
  const {
    retry = DEFAULT_RETRY,
    reads = (method) => SAFE.has(method),
    pacer,
    budget = Number.POSITIVE_INFINITY,
    sleep = realSleep,
    now = wallClock,
    random = Math.random,
  } = options

  return async (input, init = {}) => {
    const request = input instanceof Request ? input : undefined
    const method = (init.method ?? request?.method ?? "GET").toUpperCase()
    const read = reads(method, new URL(request?.url ?? String(input)))
    const signal = init.signal ?? request?.signal ?? undefined
    const once = init.body instanceof ReadableStream
    let waited = 0

    const pause = async (ms: number) => {
      waited += ms
      await sleep(ms, signal, "retry")
    }

    for (let attempt = 1; ; attempt++) {
      if (pacer) {
        const wait = (await pacer.reserve()) - now().getTime()
        if (wait > 0) {
          if (waited + wait > budget)
            throw new CliError(
              "rate_limited",
              `the provider's pace needs a ${wait} ms wait, more than this run allows`,
              {
                retry_after_ms: wait,
                sent: false,
              },
            )
          await pause(wait)
        }
      }
      const last = once || attempt > retry.retries
      try {
        const response = await send(request && !last ? request.clone() : input, init)
        if (last || !retryableStatus(response.status) || !(read || response.status === 429)) return response
        const wait = providerWaitMs(response.headers, now) ?? backoffMs(attempt, retry, random)
        if (wait > retry.maxRetryAfterMs || waited + wait > budget) return response
        await response.body?.cancel().catch(() => {})
        if (response.status === 429) await pacer?.holdFor(wait)
        await pause(wait)
      } catch (error) {
        if (last || !read || signal?.aborted || !isCliError(error) || error.details.retryable !== true) throw error
        const wait = backoffMs(attempt, retry, random)
        if (waited + wait > budget) throw error
        await pause(wait)
      }
    }
  }
}
