import { type CliErrorDetails, type ErrorCode, errorCodes, isCliError } from "./errors.js"
import { EXIT_CODES, GENERIC_FAILURE } from "./exit-codes.js"
import { visibleControls } from "./sanitize.js"
import { type Effects, writes } from "./standards/effects.js"
import {
  BASE_REASONS,
  COMMON_DETAILS,
  CRASH_CODE,
  CRASH_REASON,
  type ErrorObject,
  type ErrorReason,
} from "./standards/errors.js"
import type { LogRecord } from "./standards/log.js"
import type { NextStep } from "./standards/output.js"
import { type StepDefinition, type StepInput, stepOf } from "./standards/steps.js"

export interface FailureContext {
  /** The package's own reasons; the base ones are always known. */
  reasons?: readonly ErrorReason[]
  /** Detail keys the package allows on every reason, until each one is registered on its reason. */
  details?: readonly string[]
  steps?: readonly StepDefinition[]
  runId?: string
  /** The effects of the command that failed; left out, it counts as a write and no retry is safe. */
  effects?: Effects
  /** For the error's next step: what its command takes and whether it writes (`stepTargets` in `/commands`). */
  targets?: StepInput["targets"]
}

interface Recognised {
  code: ErrorCode
  message: string
  details: CliErrorDetails
}

// cli-base before 0.22 has no brand, and tg and max still install it beside a newer copy.
const recognise = (failure: unknown): Recognised | undefined => {
  if (isCliError(failure)) return failure
  if (!(failure instanceof Error) || failure.name !== "CliError") return undefined
  const { code, details } = failure as Error & { code?: unknown; details?: unknown }
  if (!(errorCodes as readonly unknown[]).includes(code)) return undefined
  return {
    code: code as ErrorCode,
    message: failure.message,
    details: typeof details === "object" && details !== null ? (details as CliErrorDetails) : {},
  }
}

const reasonFor = (code: ErrorObject["error"]["code"], named: unknown, reasons: readonly ErrorReason[]) =>
  reasons.find((entry) => entry.reason === named && entry.code === code) ??
  BASE_REASONS.find((entry) => entry.reason === named && entry.code === code) ??
  // The first base reason for each code is its fallback.
  (BASE_REASONS.find((entry) => entry.code === code) as ErrorReason)

const nextFor = (reason: ErrorReason, details: CliErrorDetails, context: FailureContext): NextStep[] => {
  const definition = reason.step ? context.steps?.find((step) => step.id === reason.step) : undefined
  if (!definition) return []
  const known = new Set(definition.kind === "command" ? definition.args.map((arg) => arg.name) : [])
  const args = Object.fromEntries(
    Object.entries(details).filter(([key, value]) => known.has(key) && value !== undefined),
  )
  try {
    return [stepOf(definition, { args, ...(context.targets ? { targets: context.targets } : {}) })]
  } catch {
    return []
  }
}

/** Failures that may pass by themselves; `provider_error` only when the thrower said so. */
const TRANSIENT: readonly ErrorObject["error"]["code"][] = [
  "rate_limited",
  "timeout",
  "network_error",
  "provider_unavailable",
]

/**
 * Safe means the same command may work next time and cannot do harm: a transient failure of a command that writes
 * nothing, or of a write that never left this machine. `outcome_unknown` is never safe.
 */
export const retryOf = (
  code: ErrorObject["error"]["code"],
  details: CliErrorDetails,
  effects: Effects | undefined,
): ErrorObject["error"]["retry"] => {
  const transient =
    details.retryable !== false &&
    (TRANSIENT.includes(code) || (code === "provider_error" && details.retryable === true))
  const safe = code !== "outcome_unknown" && transient && (!writes(effects) || details.sent === false)
  const after = details.retry_after_ms
  return safe && typeof after === "number" && Number.isInteger(after) && after >= 0
    ? { safe, after_ms: after }
    : { safe }
}

/** Any thrown value as the one error object. Only registered detail keys survive; `cause` never does. */
export const errorObjectOf = (failure: unknown, context: FailureContext = {}): ErrorObject => {
  const reasons = context.reasons ?? []
  const recognised = recognise(failure)
  if (!recognised) {
    const reason = reasonFor(CRASH_CODE, CRASH_REASON, reasons)
    return {
      error: {
        code: CRASH_CODE,
        reason: reason.reason,
        message: reason.message,
        retry: { safe: false },
        ...(context.runId ? { run_id: context.runId } : {}),
      },
    }
  }
  const { code, message, details } = recognised
  const reason = reasonFor(code, details.reason, reasons)
  const allowed = new Set<string>([...COMMON_DETAILS, ...(context.details ?? []), ...reason.details])
  allowed.delete("cause")
  const kept = Object.fromEntries(
    Object.entries(details).filter(([key, value]) => allowed.has(key) && value !== undefined),
  )
  const next = nextFor(reason, details, context)
  const runId = context.runId ?? (typeof details.run_id === "string" ? details.run_id : undefined)
  return {
    error: {
      code,
      reason: reason.reason,
      message,
      ...(typeof details.param === "string" ? { param: details.param } : {}),
      ...(Object.keys(kept).length > 0 ? { details: kept } : {}),
      ...(next.length > 0 ? { next } : {}),
      retry: retryOf(code, details, context.effects),
      ...(runId ? { run_id: runId } : {}),
    },
  }
}

export const exitCodeOfError = ({ error }: ErrorObject): number =>
  error.code === CRASH_CODE ? GENERIC_FAILURE : EXIT_CODES[error.code]

const kebab = (name: string) => name.replaceAll("_", "-")

const commandLine = (cli: string, step: Extract<NextStep, { kind: "command" }>): string =>
  [
    cli,
    step.command,
    ...Object.entries(step.args).map(([name, value]) =>
      value === true ? `--${kebab(name)}` : `--${kebab(name)} ${JSON.stringify(value)}`,
    ),
  ].join(" ")

export interface ErrorRecordOptions {
  /** The command path that failed, `messages list`. */
  command: string
  service: string
  version: string
  time?: Date
}

export type ErrorRecord = Omit<LogRecord, "run_id"> & { run_id?: string }

const STACK_FRAMES = 10

/** The log record of a failure, what `--debug` prints: the only place a cause or a stack is shown. */
export const errorRecordOf = (failure: unknown, object: ErrorObject, options: ErrorRecordOptions): ErrorRecord => {
  const thrown = failure instanceof Error ? failure : undefined
  const { cause, ...details } = (recognise(failure)?.details ?? {}) as CliErrorDetails
  const stack = thrown?.stack
    ?.split("\n")
    .slice(1, STACK_FRAMES + 1)
    .map((line) => visibleControls(line.trim()))
  const reason = thrown?.cause ?? cause
  return {
    time: (options.time ?? new Date()).toISOString(),
    severity: "error",
    body: object.error.message,
    ...(object.error.run_id ? { run_id: object.error.run_id } : {}),
    command: options.command,
    attributes: {
      code: object.error.code,
      reason: object.error.reason,
      ...(Object.keys(details).length > 0 ? { details } : {}),
      ...(thrown
        ? { name: thrown.name, thrown_message: visibleControls(thrown.message) }
        : { thrown: String(failure) }),
      ...(reason === undefined
        ? {}
        : { cause: visibleControls(reason instanceof Error ? reason.message : String(reason)) }),
      ...(stack && stack.length > 0 ? { stack } : {}),
    },
    resource: { service: options.service, version: options.version },
  }
}

export interface RenderErrorOptions {
  cli: string
  /** A person at a terminal; otherwise the object goes out as one JSON line. */
  interactive: boolean
  /** Under `--debug`: replaces the `details:` line, or follows the object as a second JSON line. */
  record?: ErrorRecord
}

/** `✗ message`, one `→ next step` line and where to dig, for a person; the object itself for a machine. */
export const renderError = (object: ErrorObject, options: RenderErrorOptions): string => {
  if (!options.interactive)
    return [JSON.stringify(object), ...(options.record ? [JSON.stringify(options.record)] : [])].join("\n")
  const { message, next, run_id: runId } = object.error
  const step = next?.[0]
  return [
    `✗ ${visibleControls(message)}`,
    ...(step?.kind === "command"
      ? [`→ ${visibleControls(step.why)}: ${visibleControls(commandLine(options.cli, step))}`]
      : step
        ? [`→ ${visibleControls(step.why)}`]
        : []),
    ...(options.record
      ? [JSON.stringify(options.record, null, 2)]
      : runId
        ? [`details: ${options.cli} runs show ${runId}`]
        : []),
  ].join("\n")
}

/** MCP's answer for the same object: the CLI's machine output and `structuredContent` are one value. */
export const mcpErrorResult = (object: ErrorObject) => ({
  content: [{ type: "text" as const, text: JSON.stringify(object) }],
  structuredContent: object,
  isError: true as const,
})

export interface CatchCrashesOptions extends FailureContext {
  cli: string
  interactive: boolean
  write?: (text: string) => void
  exit?: (code: number) => void
  target?: Pick<NodeJS.Process, "on" | "off">
}

/**
 * A throw before a CLI's own handler runs — a store migration at start-up — would otherwise print
 * Node's stack trace. Call it first thing; it returns the function that removes it.
 */
export const catchCrashes = (options: CatchCrashesOptions): (() => void) => {
  const target = options.target ?? process
  const write = options.write ?? ((text: string) => process.stderr.write(`${text}\n`))
  const exit = options.exit ?? ((code: number) => process.exit(code))
  const crashed = (failure: unknown) => {
    const object = errorObjectOf(failure, options)
    write(renderError(object, { cli: options.cli, interactive: options.interactive }))
    exit(exitCodeOfError(object))
  }
  target.on("uncaughtException", crashed)
  target.on("unhandledRejection", crashed)
  return () => {
    target.off("uncaughtException", crashed)
    target.off("unhandledRejection", crashed)
  }
}
