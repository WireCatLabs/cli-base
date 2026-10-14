import { CliError, isCliError } from "../errors.js"

export interface JsonResponseOptions {
  maxBytes: number
  signal?: AbortSignal
}
const interrupted = (signal: AbortSignal): CliError =>
  isCliError(signal.reason)
    ? signal.reason
    : new CliError(
        signal.reason instanceof Error && signal.reason.name === "TimeoutError" ? "timeout" : "cancelled",
        "HTTP response read was interrupted",
      )
const checked = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw interrupted(signal)
}
const abortable = async <T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return pending
  let abort: () => void = () => {}
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(interrupted(signal))
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
  })
  try {
    return await Promise.race([pending, stopped])
  } finally {
    signal.removeEventListener("abort", abort)
  }
}

export const readJsonResponse = async (response: Response, options: JsonResponseOptions): Promise<unknown> => {
  const { maxBytes, signal } = options ?? {}
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new CliError("validation_error", "maxBytes must be a positive safe integer")
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new CliError("validation_error", "signal must be an AbortSignal")
  if (signal?.aborted) {
    void response.body?.cancel().catch(() => {})
    throw interrupted(signal)
  }
  const length = response.headers.get("content-length")
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    void response.body?.cancel().catch(() => {})
    throw new CliError("invalid_response", "HTTP response exceeds the byte budget")
  }
  if (!response.body) throw new CliError("invalid_response", "HTTP response has no body")
  if (response.body.locked) throw new CliError("invalid_response", "HTTP response body is already in use")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      checked(signal)
      const part = await abortable(reader.read(), signal)
      checked(signal)
      if (part.done) break
      if (!(part.value instanceof Uint8Array)) throw new CliError("invalid_response", "HTTP response is not bytes")
      bytes += part.value.byteLength
      if (bytes > maxBytes) throw new CliError("invalid_response", "HTTP response exceeds the byte budget")
      if (part.value.byteLength) chunks.push(new Uint8Array(part.value))
    }
    const body = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))
    } catch {
      throw new CliError("invalid_response", "HTTP response is not valid UTF-8 JSON")
    }
  } catch (error) {
    checked(signal)
    if (isCliError(error)) throw error
    throw new CliError("network_error", "HTTP response could not be read")
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
