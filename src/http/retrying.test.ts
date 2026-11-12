import { describe, expect, it } from "vitest"
import { CliError } from "../errors.js"
import { type FetchLike, type RetryingOptions, retrying } from "./index.js"

const URL_ = "https://api.example.com/items"
const now = () => new Date("2026-11-12T12:00:00Z")

const harness = (answers: (Response | Error)[], options: RetryingOptions = {}) => {
  const sent: string[] = []
  const waits: number[] = []
  const send: FetchLike = async (input, init) => {
    sent.push(`${init?.method ?? "GET"} ${input instanceof Request ? input.url : String(input)}`)
    const answer = answers.shift()
    if (!answer) throw new Error("no more answers")
    if (answer instanceof Error) throw answer
    return answer
  }
  const fetch = retrying(send, {
    retry: { retries: 2, baseDelayMs: 100, maxDelayMs: 1_000, maxRetryAfterMs: 5_000 },
    sleep: async (ms) => {
      waits.push(ms)
    },
    now,
    random: () => 1,
    ...options,
  })
  return { fetch, sent, waits }
}

const status = (code: number, headers: Record<string, string> = {}) => new Response("x", { status: code, headers })
const lost = () => new CliError("network_error", "api.example.com could not be reached", { retryable: true })

describe("retrying", () => {
  it("sends a read again after a 503, waiting the backoff", async () => {
    const { fetch, sent, waits } = harness([status(503), status(200)])
    expect((await fetch(URL_)).status).toBe(200)
    expect(sent).toHaveLength(2)
    expect(waits).toEqual([100])
  })

  it("waits what the provider asked for rather than its own backoff", async () => {
    const { fetch, waits } = harness([status(429, { "retry-after": "2" }), status(200)])
    await fetch(URL_)
    expect(waits).toEqual([2_000])
  })

  it("hands back the last answer once the retries are spent", async () => {
    const { fetch, sent } = harness([status(503), status(503), status(503)])
    expect((await fetch(URL_)).status).toBe(503)
    expect(sent).toHaveLength(3)
  })

  it("does not wait longer than the provider's wait allows, or the budget", async () => {
    const asked = harness([status(429, { "retry-after": "60" })])
    expect((await asked.fetch(URL_)).status).toBe(429)
    expect(asked.waits).toEqual([])

    const budget = harness([status(503), status(503), status(200)], { budget: 250 })
    expect((await budget.fetch(URL_)).status).toBe(503)
    expect(budget.waits).toEqual([100])
  })

  it("sends a write again only when the provider refused it with 429", async () => {
    const refused = harness([status(429), status(201)])
    expect((await refused.fetch(URL_, { method: "POST", body: "{}" })).status).toBe(201)

    const failed = harness([status(503)])
    expect((await failed.fetch(URL_, { method: "POST", body: "{}" })).status).toBe(503)
    expect(failed.sent).toHaveLength(1)
  })

  it("tries a read again after a retryable error, never a write, whose outcome is unknown", async () => {
    const read = harness([lost(), status(200)])
    expect((await read.fetch(URL_)).status).toBe(200)

    const write = harness([lost()])
    await expect(write.fetch(URL_, { method: "PUT", body: "{}" })).rejects.toMatchObject({ code: "network_error" })
    expect(write.sent).toHaveLength(1)
  })

  it("does not try again after the caller cancelled", async () => {
    const controller = new AbortController()
    controller.abort()
    const { fetch, sent } = harness([lost()])
    await expect(fetch(URL_, { signal: controller.signal })).rejects.toMatchObject({ code: "network_error" })
    expect(sent).toHaveLength(1)
  })

  it("sends a streamed body once, since it cannot be read twice", async () => {
    const { fetch, sent } = harness([status(429)])
    const body = new ReadableStream({ start: (controller) => controller.close() })
    expect((await fetch(URL_, { method: "POST", body })).status).toBe(429)
    expect(sent).toHaveLength(1)
  })

  it("lines up with the pacer, and holds every process back on a 429", async () => {
    const held: number[] = []
    const pacer = {
      reserve: async () => now().getTime() + 300,
      holdFor: async (ms: number) => {
        held.push(ms)
      },
    }
    const { fetch, waits } = harness([status(429, { "retry-after": "1" }), status(200)], { pacer })
    await fetch(URL_)
    expect(held).toEqual([1_000])
    expect(waits).toEqual([300, 1_000, 300])
  })

  it("refuses a pace wait longer than the budget before sending anything", async () => {
    const pacer = { reserve: async () => now().getTime() + 10_000, holdFor: async () => {} }
    const { fetch, sent } = harness([status(200)], { pacer, budget: 1_000 })
    await expect(fetch(URL_)).rejects.toMatchObject({ code: "rate_limited", details: { sent: false } })
    expect(sent).toEqual([])
  })

  it("sends a Request again from a copy of it", async () => {
    const { fetch, sent } = harness([status(503), status(200)])
    expect((await fetch(new Request(URL_))).status).toBe(200)
    expect(sent).toEqual([`GET ${URL_}`, `GET ${URL_}`])
  })
})
