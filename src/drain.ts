import type { Writable } from "node:stream"

export const waitForDrain = (stream: Writable, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) return Promise.reject(signal.reason)
  if (stream.destroyed) return Promise.reject(new Error("output stream closed"))
  if (!stream.writableNeedDrain) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off("drain", drained).off("error", failed).off("close", closed)
      signal?.removeEventListener("abort", aborted)
    }
    const drained = () => {
      cleanup()
      resolve()
    }
    const failed = (error: unknown) => {
      cleanup()
      reject(error)
    }
    const closed = () => failed(new Error("output stream closed before drain"))
    const aborted = () => failed(signal?.reason)
    stream.once("drain", drained).once("error", failed).once("close", closed)
    signal?.addEventListener("abort", aborted, { once: true })
  })
}
