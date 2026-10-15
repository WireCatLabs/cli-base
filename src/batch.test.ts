import { describe, expect, it, vi } from "vitest"
import {
  BATCH_LIMITS,
  type BatchHandler,
  prepareBatch,
  projectBatchAnswers,
  readBatchInput,
  runBatch,
} from "./batch.js"
import { CliError } from "./errors.js"

const input = (...args: string[][]) =>
  JSON.stringify({ requests: args.map((args, i) => ({ id: `r${i}`, command: ["read"], args })) })
const handler = (run: BatchHandler["prepare"]) => [{ command: ["read"], prepare: run }]
const ok = (answer: unknown) => ({ answer, complete: true })

describe("bounded batches", () => {
  it("validates the whole shape and every handler before any operation runs", () => {
    const run = vi.fn()
    const handlers = handler((args) => {
      if (args[0] === "bad") throw new CliError("validation_error", "bad argument")
      return { run }
    })
    expect(() => prepareBatch(input(["valid"], ["bad"]), handlers)).toThrow("bad argument")
    expect(run).not.toHaveBeenCalled()
    for (const value of [
      "not json",
      "[]",
      '{"requests":[]}',
      JSON.stringify({ requests: [{ id: "x", command: ["write"], args: [] }] }),
      JSON.stringify({
        requests: [
          { id: "x", command: ["read"], args: [] },
          { id: "x", command: ["read"], args: [] },
        ],
      }),
      JSON.stringify({ requests: [{ id: "x", command: ["read"], args: [], scope: "other" }] }),
      input(...Array.from({ length: 33 }, () => [])),
      " ".repeat(BATCH_LIMITS.input_bytes + 1),
    ])
      expect(() => prepareBatch(value, handlers)).toThrow(CliError)
  })

  it("keeps order, duplicates, independent failures and continuations", async () => {
    const calls: string[] = []
    const requests = prepareBatch(
      input(["same"], ["fail"], ["same"]),
      handler((args) => ({
        run: async () => {
          calls.push(args[0] ?? "")
          if (args[0] === "fail") throw new CliError("not_found", "missing")
          return ok({ items: [{ ref: args[0] }], page: { next_cursor: args[0] }, coverage: { known: false } })
        },
      })),
    )
    const result = await runBatch(requests)
    expect(calls).toEqual(["same", "fail", "same"])
    expect(result.items.map((item) => [item.id, item.status])).toEqual([
      ["r0", "ok"],
      ["r1", "error"],
      ["r2", "ok"],
    ])
    expect(result.items[1]).toMatchObject({ error: { code: "not_found" }, complete: false })
    expect(result.complete).toBe(false)
    expect(result.items[2]).toMatchObject({ answer: { page: { next_cursor: "same" }, coverage: { known: false } } })
  })

  it("reserves read ceilings, never refunds failed reads and identifies every unprocessed input", async () => {
    const read = vi.fn()
    const requests = prepareBatch(
      input([], [], []),
      handler(() => ({
        run: async (ctx) => {
          ctx.reserveReadBytes(6)
          read()
          throw new CliError("not_found", "not present")
        },
      })),
    )
    const result = await runBatch(requests, { maxReadBytes: 10 })
    expect(read).toHaveBeenCalledTimes(1)
    expect(result.read_bytes_reserved).toBe(6)
    expect(result.items.map((item) => item.status)).toEqual(["error", "not_run", "not_run"])
    expect(result.items[2]).toMatchObject({ error: { reason: "batch.read-budget" } })
  })

  it("bounds retained output and stops reads while retaining all remaining ids", async () => {
    const run = vi.fn(async () => ok("x".repeat(30000)))
    const result = await runBatch(
      prepareBatch(
        input([], [], []),
        handler(() => ({ run })),
      ),
      { maxOutputBytes: 20000 },
    )
    expect(run).toHaveBeenCalledTimes(1)
    expect(result.output_limited).toBe(true)
    expect(result.items.map((item) => item.status)).toEqual(["error", "not_run", "not_run"])
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(20000)
  })

  it("bounds verbose failures and hides unknown crash details", async () => {
    const result = await runBatch(
      prepareBatch(
        input(["large"], ["crash"]),
        handler((args) => ({
          run: async () => {
            if (args[0] === "large") throw new CliError("not_found", "x".repeat(100000))
            throw new Error("private provider payload")
          },
        })),
      ),
    )
    expect(Buffer.byteLength(JSON.stringify(result.items))).toBeLessThan(2048)
    expect(JSON.stringify(result)).not.toContain("private provider payload")
    expect(result.items[0]).toMatchObject({ error: { code: "not_found" } })
  })

  it("propagates cancellation without starting another read or claiming completion", async () => {
    const controller = new AbortController(),
      run = vi.fn(async () => {
        controller.abort(new CliError("cancelled", "stop"))
        return ok("read before cancellation")
      })
    await expect(
      runBatch(
        prepareBatch(
          input([], []),
          handler(() => ({ run })),
        ),
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "cancelled" })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("counts projected answers before the output ceiling without reducing work", async () => {
    const run = vi.fn(async () =>
      ok({ item: { ref: "meeting:1/1/1/0", large: "x".repeat(30000) }, meta: { complete: true } }),
    )
    const report = await runBatch(
      prepareBatch(
        input([]),
        handler(() => ({ run })),
      ),
      { fields: ["ref"], maxOutputBytes: 12000 },
    )
    expect(report.items[0]).toMatchObject({ status: "ok", answer: { item: { ref: "meeting:1/1/1/0" } } })
    expect(JSON.stringify(report)).not.toContain("large")
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("projects nested answers while preserving correlation, failures and completeness", async () => {
    const report = await runBatch(
      prepareBatch(
        input([], []),
        handler(() => ({
          run: async () =>
            ok({
              item: { items: [{ ref: "meeting:1/1/1/0", text: "sample", noise: 4 }], coverage: { unknown: true } },
              meta: { complete: true },
            }),
        })),
      ),
    )
    const projected = projectBatchAnswers(report, ["items.ref", "items.text"])
    expect(projected.items[0]).toMatchObject({
      id: "r0",
      command: ["read"],
      status: "ok",
      complete: true,
      answer: {
        item: { coverage: { unknown: true }, items: [{ ref: "meeting:1/1/1/0", text: "sample" }] },
        meta: { complete: true },
      },
    })
    expect(JSON.stringify(projected)).not.toContain("noise")
    expect(JSON.stringify(report)).toContain("noise")
  })

  it("reads bounded split UTF-8 input, closes on excess and rejects malformed encodings", async () => {
    const bytes = Buffer.from('{"requests":"пример"}')
    async function* chunks() {
      yield bytes.subarray(0, 17)
      yield bytes.subarray(17)
    }
    expect(await readBatchInput(chunks())).toBe(bytes.toString())
    let closed = false
    async function* tooLarge() {
      try {
        yield Buffer.alloc(BATCH_LIMITS.input_bytes)
        yield "x"
      } finally {
        closed = true
      }
    }
    await expect(readBatchInput(tooLarge())).rejects.toThrow("exceeds")
    expect(closed).toBe(true)
    async function* invalid() {
      yield new Uint8Array([0xff])
    }
    await expect(readBatchInput(invalid())).rejects.toThrow("UTF-8")
    const controller = new AbortController()
    controller.abort(new Error("cancel input"))
    await expect(readBatchInput(chunks(), { signal: controller.signal })).rejects.toThrow("cancel input")
  })
})
