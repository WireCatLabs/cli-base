import { once } from "node:events"
import http from "node:http"
import https, { request as namedRequest } from "node:https"
import type { AddressInfo } from "node:net"
import net from "node:net"
import tls from "node:tls"
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest"
import { allowNetwork } from "./index.js"

const REFUSED = /a test tried to reach example\.com/

describe("the network guard from the shared setup", () => {
  let server: http.Server
  let port: number

  beforeAll(async () => {
    server = http.createServer((_request, response) => response.end("local"))
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  it("refuses fetch to a remote host, naming it", async () => {
    await expect(fetch("https://example.com/")).rejects.toThrow(REFUSED)
    await expect(fetch(new Request("https://example.com/"))).rejects.toThrow(REFUSED)
  })

  it("refuses net, tls, http and https connections to a remote host", () => {
    expect(() => net.connect(443, "example.com")).toThrow(REFUSED)
    expect(() => net.connect({ host: "example.com", port: 443 })).toThrow(REFUSED)
    expect(() => tls.connect({ host: "example.com", port: 443 })).toThrow(REFUSED)
    expect(() => http.get("http://example.com/")).toThrow(REFUSED)
    expect(() => https.get("https://example.com/")).toThrow(REFUSED)
    expect(() => namedRequest({ hostname: "example.com" })).toThrow(REFUSED)
  })

  it("refuses a WebSocket to a remote host", () => {
    expect(() => new WebSocket("wss://example.com/")).toThrow(REFUSED)
  })

  it("lets fetch read a data URL, which opens no connection", async () => {
    expect(await (await fetch("data:text/plain,ok")).text()).toBe("ok")
  })

  it("lets fetch and http reach this machine", async () => {
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("local")
    const response = await new Promise<http.IncomingMessage>((resolve, reject) =>
      http.get(`http://localhost:${port}/`, resolve).on("error", reject),
    )
    response.resume()
    expect(response.statusCode).toBe(200)
  })

  it("treats every 127.x.x.x address as this machine, and nothing that only looks like one", async () => {
    const closed = (error: unknown) => expect(String(error)).not.toMatch(/a test tried to reach/)
    const socket = net.connect(1, "127.0.0.2")
    socket.on("error", closed)
    socket.destroy()
    const request = http.get("http://127.255.0.9:1/")
    request.on("error", closed)
    request.destroy()
    await fetch("http://127.0.0.2:1/").catch(closed)

    expect(() => net.connect(443, "128.0.0.1")).toThrow(/a test tried to reach 128\.0\.0\.1/)
    expect(() => net.connect(443, "127.0.0.1.example.com")).toThrow(/a test tried to reach/)
  })

  it("lets a connection through after allowNetwork, until it is restored", () => {
    const restore = allowNetwork()
    onTestFinished(restore)
    const socket = net.connect({
      host: "example.com",
      port: 443,
      lookup: (_host, _options, callback) => {
        callback(new Error("lookup stopped by the test"), "", 4)
      },
    })
    socket.on("error", () => {})
    socket.destroy()
    restore()
    expect(() => net.connect(443, "example.com")).toThrow(REFUSED)
  })
})
