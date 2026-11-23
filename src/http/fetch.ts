import { CliError, isCliError } from "../errors.js"
import { hostCovered, hostProblems } from "./hosts.js"
import type { FetchLike } from "./index.js"

export interface HostFetchOptions {
  /** The identity's `hosts`, plus any host the person configured (`userHosts`). */
  hosts: readonly string[]
  fetch?: FetchLike
  /** For the whole exchange, every redirect and the body. */
  timeoutMs?: number
  redirects?: number
  /**
   * Where the sign-in may go, as `https://host/blog/wp-json`: a site under a path shares its host with others. A signed
   * request outside it is refused, and a redirect out of it drops the sign-in. Without it, the origin is the limit.
   */
  credentialScope?: string
}

/** @experimental */
export const HOST_FETCH_TIMEOUT_MS = 30_000
const REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"]

const NO_BODY = new Set([204, 205, 304])

// Not AbortSignal.timeout: its timer, and the async context it holds, lives to the deadline after the exchange ended.
// tg-cli's Bot API tests peaked at 3 GB with it and 0.8 GB with this timer, cleared once the body is read.
const deadline = (ms: number) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException(`no answer within ${ms} ms`, "TimeoutError")), ms)
  timer.unref?.()
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

/** The response with its body read through a stream that clears the timer at its end. */
const released = (response: Response, clear: () => void): Response => {
  if (!response.body || NO_BODY.has(response.status) || response.status < 200 || response.status > 599) {
    clear()
    return response
  }
  const { status, statusText, headers, url, redirected } = response
  const wrapped = new Response(response.body.pipeThrough(new TransformStream({ flush: clear })), {
    status,
    statusText,
    headers,
  })
  return Object.defineProperties(wrapped, { url: { value: url }, redirected: { value: redirected } })
}

const undeclared = (url: URL) =>
  new CliError(
    "configuration_error",
    `${url.hostname} is not a host this CLI declares: add "${url.hostname}" to \`hosts\` in its WCAT identity and run cli-dev manifest`,
    { reason: "network.host-undeclared", sent: false },
  )

const checked = (url: URL, hosts: readonly string[]): URL => {
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new CliError("validation_error", `only http and https are fetched, not ${url.protocol.replace(/:$/, "")}`, {
      sent: false,
    })
  if (!hostCovered(url.hostname, hosts)) throw undeclared(url)
  return url
}

// A server that decodes `%2F` before it routes would take `/blog/..%2F..%2Fother` out of the scope the prefix saw.
const ENCODED_SLASH = /%2f|%5c/i

const scopeOf = (scope: string | undefined) => {
  if (scope === undefined) return undefined
  if (!URL.canParse(scope)) throw new CliError("configuration_error", `credentialScope ${scope} is not a URL`)
  const { origin, pathname } = new URL(scope)
  const prefix = pathname.endsWith("/") ? pathname : `${pathname}/`
  return (url: URL) =>
    url.origin === origin &&
    (url.pathname === pathname || url.pathname.startsWith(prefix)) &&
    !ENCODED_SLASH.test(url.pathname)
}

const signedHeaders = (headers: Headers) => CREDENTIAL_HEADERS.some((name) => headers.has(name))

/**
 * A name lookup or a connection the host refused fails before a byte of the request leaves, so even a write may be sent
 * again. Node's fetch puts the system's code on the cause, an AggregateError when it tried several addresses; a
 * reset or a timeout may come after the request arrived.
 */
const NOT_SENT = new Set(["EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED"])
const neverSent = (error: unknown): boolean => {
  for (let at: unknown = error, depth = 0; at instanceof Error && depth < 4; at = at.cause, depth++) {
    const code = (at as { code?: unknown }).code
    if (typeof code === "string" && NOT_SENT.has(code)) return true
  }
  return false
}

/** `fetch` that reaches only the declared hosts, checks every redirect hop, and gives up after `timeoutMs`. */
export const hostFetch = (options: HostFetchOptions): FetchLike => {
  const problems = hostProblems(options.hosts)
  if (problems.length > 0) throw new CliError("configuration_error", problems.join("; "))
  const { hosts, fetch: send = globalThis.fetch, timeoutMs = HOST_FETCH_TIMEOUT_MS, redirects = REDIRECTS } = options
  const inScope = scopeOf(options.credentialScope)

  return async (input, init = {}) => {
    const request = input instanceof Request ? input : undefined
    let url = checked(new URL(request?.url ?? String(input)), hosts)
    const caller = init.signal ?? request?.signal
    const timeout = deadline(timeoutMs)
    const signal = caller ? AbortSignal.any([caller, timeout.signal]) : timeout.signal
    const follow = (init.redirect ?? request?.redirect ?? "follow") === "follow"
    let method = (init.method ?? request?.method ?? "GET").toUpperCase()
    let body = init.body ?? request?.body ?? undefined
    const headers = new Headers(init.headers ?? request?.headers)
    if (inScope && signedHeaders(headers) && !inScope(url))
      throw new CliError(
        "configuration_error",
        `the sign-in goes only under ${options.credentialScope}, not ${url.origin}${url.pathname}`,
        {
          sent: false,
        },
      )
    // A redirect means the first request arrived: a later hop's failure no longer proves nothing was sent.
    let answered = false

    try {
      let response = await send(input, { ...init, signal, ...(follow ? { redirect: "manual" } : {}) })
      answered = true
      for (let hop = 0; follow && REDIRECT_STATUSES.has(response.status); hop += 1) {
        const location = response.headers.get("location")
        if (!location) return released(response, timeout.clear)
        if (hop >= redirects)
          throw new CliError("invalid_response", `more than ${redirects} redirects from ${url.hostname}`)
        void response.body?.cancel().catch(() => {})
        const next = checked(new URL(location, url), hosts)
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
          method = method === "HEAD" ? "HEAD" : "GET"
          body = undefined
          headers.delete("content-type")
          headers.delete("content-length")
        } else if (body instanceof ReadableStream)
          throw new CliError(
            "invalid_response",
            `${url.hostname} redirected a streamed body, which cannot be sent again`,
          )
        if (inScope ? !inScope(next) : next.origin !== url.origin)
          for (const name of CREDENTIAL_HEADERS) headers.delete(name)
        url = next
        response = await send(url, { ...init, method, headers, body, signal, redirect: "manual" })
      }
      return released(response, timeout.clear)
    } catch (error) {
      timeout.clear()
      if (isCliError(error)) throw error
      if (caller?.aborted)
        throw isCliError(caller.reason) ? caller.reason : new CliError("cancelled", "request cancelled")
      if (timeout.signal.aborted)
        throw new CliError("timeout", `${url.hostname} did not answer within ${timeoutMs} ms`, { retryable: true })
      throw new CliError("network_error", `${url.hostname} could not be reached`, {
        retryable: true,
        ...(!answered && neverSent(error) ? { sent: false } : {}),
      })
    }
  }
}
