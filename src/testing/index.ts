/**
 * The seams a test needs, so that "no test touched the real machine" is a property of the code
 * rather than a hope about every test remembering to opt out.
 */

export { brokenKeyring, memoryKeyring } from "../keyring.js"
export { captureStreams } from "../streams.js"

import { type LogEvent, logEventProblems } from "../standards/log.js"

/** Throws, naming each, when a written log line is not a registered event with its keys. */
export const expectRegisteredEvents = (lines: readonly string[], events: readonly LogEvent[]): void => {
  const problems = lines.flatMap((line) => logEventProblems(JSON.parse(line), events))
  if (problems.length > 0) throw new Error(`unregistered log events:\n${problems.join("\n")}`)
}

import type { MonotonicClock, SleepLike, WallClock } from "../time.js"

export interface FakeClock {
  clock: MonotonicClock
  now: WallClock
  sleep: SleepLike
  /** Every sleep asked for, in order, with the reason the caller gave. Nothing actually waits. */
  waits: { ms: number; reason?: string }[]
  advance(ms: number): void
}

/**
 * Time that never passes unless a test says so. A retry test that really sleeps 250 ms is a retry
 * test nobody runs, so `sleep` resolves at once and records what it was asked for.
 */
export const fakeClock = (startMs = 0): FakeClock => {
  let elapsed = startMs
  const waits: { ms: number; reason?: string }[] = []

  return {
    waits,
    clock: () => elapsed,
    now: () => new Date(startMs + elapsed),
    sleep: async (ms, signal, reason) => {
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError")
      waits.push(reason === undefined ? { ms } : { ms, reason })
      elapsed += ms
    },
    advance: (ms) => {
      elapsed += ms
    },
  }
}
