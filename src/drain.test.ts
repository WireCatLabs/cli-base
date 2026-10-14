import { Writable } from "node:stream"
import { describe, expect, it } from "vitest"
import { waitForDrain } from "./drain.js"

describe("output drain", () => {
  it("waits for a slow output and writes each chunk once", async () => {
    const chunks: string[] = []
    let complete: (() => void) | undefined
    const output = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, done) {
        chunks.push(chunk.toString())
        complete = done
      },
    })
    expect(output.write("first")).toBe(false)
    let drained = false
    const pending = waitForDrain(output).then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    complete?.()
    await pending
    expect(chunks).toEqual(["first"])
    output.end()
  })

  it("cancels a stalled drain and releases its listeners", async () => {
    const output = new Writable({ highWaterMark: 1, write() {} })
    output.write("pending")
    const stop = new AbortController()
    const pending = waitForDrain(output, stop.signal)
    stop.abort(new Error("cancelled"))
    await expect(pending).rejects.toThrow("cancelled")
    expect(output.listenerCount("drain")).toBe(0)
    expect(output.listenerCount("error")).toBe(0)
    output.destroy()
  })
})
