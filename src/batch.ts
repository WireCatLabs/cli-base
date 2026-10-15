import { CliError } from "./errors.js"
import { errorObjectOf, type FailureContext } from "./failure.js"
import { projectFields } from "./result-fields.js"

export const BATCH_LIMITS = Object.freeze({
  requests: 32,
  input_bytes: 262144,
  read_bytes: 67108864,
  output_bytes: 4194304,
})

export interface BatchContext {
  signal?: AbortSignal
  reserveReadBytes: (bytes: number) => void
}
export interface BatchOperation {
  run: (context: BatchContext) => Promise<{ answer: unknown; complete: boolean }>
}
export interface BatchHandler {
  command: readonly string[]
  prepare: (args: readonly string[]) => BatchOperation
}
export interface PreparedBatchRequest {
  id: string
  command: string[]
  operation: BatchOperation
}
export type BatchResult = { id: string; command: string[] } & (
  | { status: "ok"; answer: unknown; complete: boolean }
  | { status: "error" | "not_run"; error: ReturnType<typeof errorObjectOf>["error"]; complete: false }
)
export interface BatchReport {
  items: BatchResult[]
  complete: boolean
  read_bytes_reserved: number
  read_bytes_limit: number
  output_limited: boolean
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
function invalid(message: string): never {
  throw new CliError("validation_error", message)
}
const limit = (value: number, maximum: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) invalid(`invalid batch ${name} limit`)
  return value
}
const budgetError = (kind: "read" | "output") =>
  new CliError("validation_error", `batch ${kind} budget exhausted; this input was not completed`, {
    reason: `batch.${kind}-budget`,
  })

/** Preparation is pure: every handler validates before a caller can begin work. */
export const prepareBatch = (input: string, handlers: readonly BatchHandler[]): PreparedBatchRequest[] => {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > BATCH_LIMITS.input_bytes)
    invalid("batch input exceeds 262144 UTF-8 bytes")
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    invalid("batch input must be a JSON object with requests")
  }
  if (!record(value) || Object.keys(value).some((key) => key !== "requests") || !Array.isArray(value.requests))
    invalid("batch input must contain only a requests array")
  const requests = value.requests as unknown[]
  if (requests.length < 1 || requests.length > BATCH_LIMITS.requests) invalid("batch takes 1–32 requests")
  const ids = new Set<string>()
  return requests.map((request) => {
    if (
      !record(request) ||
      Object.keys(request).some((key) => !["id", "command", "args"].includes(key)) ||
      typeof request.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(request.id) ||
      ids.has(request.id) ||
      !Array.isArray(request.command) ||
      request.command.length < 1 ||
      request.command.length > 8 ||
      request.command.some((word) => typeof word !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(word)) ||
      !Array.isArray(request.args) ||
      request.args.length > 128 ||
      request.args.some((arg) => typeof arg !== "string" || arg.includes("\0"))
    )
      invalid("each batch request needs a unique id, registered command path and string args array")
    const id = request.id as string
    const command = [...(request.command as string[])]
    const args = request.args as string[]
    ids.add(id)
    const handler = handlers.find(
      (entry) => entry.command.length === command.length && entry.command.every((word, i) => word === command[i]),
    )
    if (!handler) invalid(`unsupported batch command: ${command.join(" ")}`)
    return { id, command, operation: handler.prepare(args) }
  })
}

export const readBatchInput = async (
  source: AsyncIterable<string | Uint8Array>,
  options: { signal?: AbortSignal } = {},
): Promise<string> => {
  const chunks: Buffer[] = []
  let bytes = 0
  options.signal?.throwIfAborted()
  for await (const chunk of source) {
    options.signal?.throwIfAborted()
    const data = Buffer.from(chunk)
    bytes += data.byteLength
    if (bytes > BATCH_LIMITS.input_bytes) invalid("batch input exceeds 262144 UTF-8 bytes")
    chunks.push(data)
  }
  options.signal?.throwIfAborted()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  try {
    return decoder.decode(Buffer.concat(chunks))
  } catch {
    return invalid("batch input must be valid UTF-8")
  }
}

/** Reservations are conservative ceilings, never a claim about bytes actually consumed. */
export const runBatch = async (
  requests: readonly PreparedBatchRequest[],
  options: {
    signal?: AbortSignal
    maxReadBytes?: number
    maxOutputBytes?: number
    failureContext?: FailureContext
    fields?: readonly string[]
  } = {},
): Promise<BatchReport> => {
  if (!requests.length || requests.length > BATCH_LIMITS.requests) invalid("batch takes 1–32 requests")
  if (options.fields) projectFields({}, options.fields)
  const maxReadBytes = limit(options.maxReadBytes ?? BATCH_LIMITS.read_bytes, BATCH_LIMITS.read_bytes, "read")
  const maxOutputBytes = limit(options.maxOutputBytes ?? BATCH_LIMITS.output_bytes, BATCH_LIMITS.output_bytes, "output")
  // Keep room for every correlated refusal plus the host's standard envelope/end framing.
  if (maxOutputBytes < 8192 + requests.length * 2048) invalid("batch output budget cannot hold its result framing")
  const errorOf = (error: unknown) => {
    const object = errorObjectOf(error, options.failureContext).error
    try {
      if (Buffer.byteLength(JSON.stringify(object), "utf8") <= 512) return object
    } catch {
      // A caller's diagnostic details may contain cycles; keep the standard failure framing usable.
    }
    const fallback = errorObjectOf(error).error
    return {
      code: fallback.code,
      reason: fallback.reason,
      message: "batch input failed; error details exceed its output allowance",
      retry: fallback.retry,
    }
  }
  const items: BatchResult[] = []
  let reserved = 0,
    outputBytes = 8192,
    outputLimited = false
  const context: BatchContext = {
    signal: options.signal,
    reserveReadBytes(bytes) {
      limit(bytes, BATCH_LIMITS.read_bytes, "operation read")
      if (bytes > maxReadBytes - reserved) throw budgetError("read")
      reserved += bytes
    },
  }
  for (const [index, request] of requests.entries()) {
    options.signal?.throwIfAborted()
    const framing = { id: request.id, command: request.command }
    let result: BatchResult
    if (outputLimited)
      result = { ...framing, status: "not_run", error: errorOf(budgetError("output")), complete: false }
    else {
      try {
        const answer = await request.operation.run(context)
        options.signal?.throwIfAborted()
        result = {
          ...framing,
          status: "ok",
          ...answer,
          ...(options.fields ? { answer: projectFields(answer.answer, options.fields) } : {}),
        }
        const bytes = Buffer.byteLength(JSON.stringify(result), "utf8")
        if (bytes > maxOutputBytes - outputBytes - (requests.length - index - 1) * 2048) {
          outputLimited = true
          result = { ...framing, status: "error", error: errorOf(budgetError("output")), complete: false }
        }
      } catch (error) {
        options.signal?.throwIfAborted()
        const object = errorOf(error)
        result = {
          ...framing,
          status: object.reason === "batch.read-budget" ? "not_run" : "error",
          error: object,
          complete: false,
        }
      }
    }
    outputBytes += Buffer.byteLength(JSON.stringify(result), "utf8")
    items.push(result)
  }
  return {
    items,
    complete: items.every((item) => item.complete),
    read_bytes_reserved: reserved,
    read_bytes_limit: maxReadBytes,
    output_limited: outputLimited,
  }
}

export const projectBatchAnswers = (report: BatchReport, fields: readonly string[]): BatchReport => ({
  ...report,
  items: report.items.map((result) =>
    result.status === "ok" ? { ...result, answer: projectFields(result.answer, fields) } : result,
  ),
})
