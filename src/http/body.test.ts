import { expect, it, vi } from "vitest"
import { CliError } from "../errors.js"
import { readJsonResponse } from "./index.js"

const encoded = (text: string) => new TextEncoder().encode(text)
const responseOf = (chunks: Uint8Array[], headers?: Record<string, string>) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
    { headers },
  )

it("reads split UTF-8 at the exact byte budget and releases the body", async () => {
  const bytes = encoded('{"text":"€"}')
  const response = responseOf([bytes.slice(0, 10), bytes.slice(10)])
  expect(await readJsonResponse(response, { maxBytes: bytes.length })).toEqual({ text: "€" })
  expect(response.body?.locked).toBe(false)
})
it.each([null, [], 42, "example", true])(
  "returns valid JSON values without imposing a provider object schema: %j",
  async (value) => {
    expect(await readJsonResponse(new Response(JSON.stringify(value)), { maxBytes: 100 })).toEqual(value)
  },
)
it.each([0, -1, 1.5, NaN, Infinity])("rejects invalid byte budgets before reading: %s", async (maxBytes) => {
  const response = new Response("{}")
  await expect(readJsonResponse(response, { maxBytes })).rejects.toMatchObject({ code: "validation_error" })
  expect(response.bodyUsed).toBe(false)
})
it.each([undefined, "1"])("counts actual bytes with missing or understated length: %s", async (length) => {
  const response = responseOf([encoded("[1,"), encoded("2]")], length ? { "content-length": length } : undefined)
  await expect(readJsonResponse(response, { maxBytes: 4 })).rejects.toMatchObject({ code: "invalid_response" })
  expect(response.body?.locked).toBe(false)
})
it("rejects one oversized chunk without parsing its content", async () => {
  const response = responseOf([encoded('{"private":"synthetic-body-marker"}')])
  await expect(readJsonResponse(response, { maxBytes: 2 })).rejects.toMatchObject({ code: "invalid_response" })
  expect(response.body?.locked).toBe(false)
})
it.each(["100", "-1", "1.5", "invalid"])(
  "cancels a rejected declared length without acquiring a reader: %s",
  async (length) => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), { headers: { "content-length": length } })
    await expect(readJsonResponse(response, { maxBytes: 2 })).rejects.toMatchObject({ code: "invalid_response" })
    expect(cancel).toHaveBeenCalledOnce()
    expect(response.body?.locked).toBe(false)
  },
)
it.each([encoded("not-json-synthetic-marker"), new Uint8Array([0x22, 0xff, 0x22])])(
  "refuses malformed JSON or UTF-8 without exposing response content",
  async (bytes) => {
    const response = responseOf([bytes])
    await expect(readJsonResponse(response, { maxBytes: 100 })).rejects.toMatchObject({
      code: "invalid_response",
      message: "HTTP response is not valid UTF-8 JSON",
    })
    expect(response.body?.locked).toBe(false)
  },
)
it("refuses a missing body and preserves a foreign reader", async () => {
  await expect(readJsonResponse(new Response(null), { maxBytes: 100 })).rejects.toMatchObject({
    code: "invalid_response",
  })
  const response = new Response("{}")
  const reader = response.body?.getReader()
  await expect(readJsonResponse(response, { maxBytes: 100 })).rejects.toMatchObject({ code: "invalid_response" })
  expect(response.body?.locked).toBe(true)
  await reader?.cancel()
  reader?.releaseLock()
})
it("cancels an already interrupted body before reading", async () => {
  const controller = new AbortController()
  controller.abort()
  const cancel = vi.fn()
  const response = new Response(new ReadableStream({ cancel }))
  await expect(readJsonResponse(response, { maxBytes: 100, signal: controller.signal })).rejects.toMatchObject({
    code: "cancelled",
  })
  expect(cancel).toHaveBeenCalledOnce()
})
it.each([
  new DOMException("synthetic", "TimeoutError"),
  new CliError("timeout", "synthetic timeout"),
  new Error("synthetic private reason"),
])("interrupts a stalled read and releases its reader: %s", async (reason) => {
  const controller = new AbortController()
  const cancel = vi.fn()
  const response = new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel }))
  const pending = readJsonResponse(response, { maxBytes: 100, signal: controller.signal })
  controller.abort(reason)
  await expect(pending).rejects.toMatchObject({
    code: reason.name === "TimeoutError" || reason instanceof CliError ? "timeout" : "cancelled",
  })
  expect(cancel).toHaveBeenCalledOnce()
  expect(response.body?.locked).toBe(false)
})
it("reports transport failures without exposing the stream error", async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error("synthetic-private-marker"))
      },
    }),
  )
  await expect(readJsonResponse(response, { maxBytes: 100 })).rejects.toMatchObject({
    code: "network_error",
    message: "HTTP response could not be read",
  })
  expect(response.body?.locked).toBe(false)
})

it("detaches bytes when a producer reuses its Buffer after a read", async () => {
  const first = Buffer.from("[1,")
  let part = 0
  const response = new Response(
    new ReadableStream(
      {
        pull(controller) {
          if (part++ === 0) controller.enqueue(first)
          else {
            first[1] = 57
            controller.enqueue(Buffer.from("2]"))
            controller.close()
          }
        },
      },
      { highWaterMark: 0 },
    ),
  )
  expect(await readJsonResponse(response, { maxBytes: 5 })).toEqual([1, 2])
})
it("validates the cancellation argument before acquiring the body", async () => {
  const response = new Response("null")
  await expect(readJsonResponse(response, { maxBytes: 4, signal: {} as AbortSignal })).rejects.toMatchObject({
    code: "validation_error",
  })
  expect(response.bodyUsed).toBe(false)
})
