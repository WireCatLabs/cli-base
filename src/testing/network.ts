import http from "node:http"
import https from "node:https"
import { syncBuiltinESMExports } from "node:module"
import net from "node:net"

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
const STATE = Symbol.for("@wirecat/cli-base/testing/network")

interface GuardState {
  installed: boolean
  allowed: number
}

const state = (): GuardState => {
  const holder = globalThis as { [STATE]?: GuardState }
  holder[STATE] ??= { installed: false, allowed: 0 }
  return holder[STATE]
}

export const networkRefused = (host: string): Error =>
  new Error(
    `a test tried to reach ${host} — tests use a local server or a scripted adapter; ` +
      "the one test that must reach the network calls onTestFinished(allowNetwork())",
  )

const refuseUnlessLocal = (host: string): void => {
  if (state().allowed > 0 || LOCAL.has(host.toLowerCase())) return
  throw networkRefused(host)
}

type ConnectArgs = unknown[]

// `net.connect` hands `Socket#connect` its arguments already normalised into an array.
const hostOf = (args: ConnectArgs): string | undefined => {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  if (typeof first === "object" && first !== null) {
    const options = first as { host?: string; path?: string | null }
    if (typeof options.path === "string") return undefined
    return options.host || "localhost"
  }
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first)))
    return typeof args[1] === "string" && args[1] !== "" ? args[1] : "localhost"
  return undefined
}

const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"])

// `data:` and `blob:` URLs open no connection and have no host.
const hostOfUrl = (input: unknown): string | undefined => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  return NETWORK_SCHEMES.has(url.protocol) ? url.hostname : undefined
}

interface RequestOptions {
  hostname?: string | null
  host?: string | null
  socketPath?: string
}

const hostOfRequest = (args: unknown[]): string | undefined => {
  const [first, second] = args
  const fromUrl = typeof first === "string" || first instanceof URL ? new URL(first).hostname : undefined
  const options = [first, second].find(
    (arg): arg is RequestOptions => typeof arg === "object" && arg !== null && !(arg instanceof URL),
  )
  if (options?.socketPath) return undefined
  return options?.hostname || options?.host || fromUrl || "localhost"
}

// The agent opens the socket on a later tick, where a throw from `Socket#connect` lands as an
// uncaught exception; checked here, the caller of `request` gets it.
const guardRequests = (module: typeof http | typeof https): void => {
  for (const name of ["request", "get"] as const) {
    const real = module[name] as (...args: unknown[]) => http.ClientRequest
    module[name] = ((...args: unknown[]) => {
      const host = hostOfRequest(args)
      if (host !== undefined) refuseUnlessLocal(host)
      return real(...args)
    }) as typeof module.request
  }
}

/**
 * Refuses every outbound connection except to this machine, before any name is looked up.
 * `Socket#connect` is what `net`, `tls`, `http(s)` and Node's own `fetch` all end in; `http(s)`,
 * `fetch` and `WebSocket` are checked first as well, because through them a refused socket surfaces
 * only as "fetch failed", an error event or an uncaught exception, and Bun's `fetch` skips `net`.
 * Installed once per worker and never removed: a worker that runs tests never needs the network.
 */
export const installNetworkGuard = (): void => {
  const guard = state()
  if (guard.installed) return
  guard.installed = true

  const connect = net.Socket.prototype.connect as (...args: ConnectArgs) => net.Socket
  net.Socket.prototype.connect = function (this: net.Socket, ...args: ConnectArgs) {
    const host = hostOf(args)
    if (host !== undefined) refuseUnlessLocal(host)
    return connect.apply(this, args)
  } as typeof net.Socket.prototype.connect
  guardRequests(http)
  guardRequests(https)
  syncBuiltinESMExports()

  const realFetch = globalThis.fetch
  if (realFetch)
    globalThis.fetch = async (input, init) => {
      const host = hostOfUrl(input)
      if (host !== undefined) refuseUnlessLocal(host)
      return realFetch(input, init)
    }

  const RealWebSocket = globalThis.WebSocket
  if (RealWebSocket)
    globalThis.WebSocket = new Proxy(RealWebSocket, {
      construct(target, args, newTarget) {
        const host = hostOfUrl(args[0])
        if (host !== undefined) refuseUnlessLocal(host)
        return Reflect.construct(target, args, newTarget)
      },
    })
}

/**
 * Lets the network through until the returned function is called:
 * `onTestFinished(allowNetwork())`. For the rare test whose subject is the network itself.
 */
export const allowNetwork = (): (() => void) => {
  state().allowed++
  let restored = false
  return () => {
    if (restored) return
    restored = true
    state().allowed--
  }
}
