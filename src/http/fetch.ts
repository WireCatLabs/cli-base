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
}

export const HOST_FETCH_TIMEOUT_MS = 30_000
const REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"]

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

/** `fetch` that reaches only the declared hosts, checks every redirect hop, and gives up after `timeoutMs`. */
export const hostFetch = (options: HostFetchOptions): FetchLike => {
  const problems = hostProblems(options.hosts)
  if (problems.length > 0) throw new CliError("configuration_error", problems.join("; "))
  const { hosts, fetch: send = globalThis.fetch, timeoutMs = HOST_FETCH_TIMEOUT_MS, redirects = REDIRECTS } = options

  return async (input, init = {}) => {
    const request = input instanceof Request ? input : undefined
    let url = checked(new URL(request?.url ?? String(input)), hosts)
    const caller = init.signal ?? request?.signal
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = caller ? AbortSignal.any([caller, timeout]) : timeout
    const follow = (init.redirect ?? request?.redirect ?? "follow") === "follow"
    let method = (init.method ?? request?.method ?? "GET").toUpperCase()
    let body = init.body ?? request?.body ?? undefined
    const headers = new Headers(init.headers ?? request?.headers)

    try {
      let response = await send(input, { ...init, signal, ...(follow ? { redirect: "manual" } : {}) })
      for (let hop = 0; follow && REDIRECT_STATUSES.has(response.status); hop += 1) {
        const location = response.headers.get("location")
        if (!location) return response
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
        if (next.origin !== url.origin) for (const name of CREDENTIAL_HEADERS) headers.delete(name)
        url = next
        response = await send(url, { ...init, method, headers, body, signal, redirect: "manual" })
      }
      return response
    } catch (error) {
      if (isCliError(error)) throw error
      if (caller?.aborted)
        throw isCliError(caller.reason) ? caller.reason : new CliError("cancelled", "request cancelled")
      if (timeout.aborted)
        throw new CliError("timeout", `${url.hostname} did not answer within ${timeoutMs} ms`, { retryable: true })
      throw new CliError("network_error", `${url.hostname} could not be reached`, { retryable: true })
    }
  }
}
