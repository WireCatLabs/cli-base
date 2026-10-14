import { describe, expect, it } from "vitest"
import { backoffMs, DEFAULT_RETRY } from "./retry.js"

describe("backoffMs", () => {
  it("is full jitter: never more than the exponential ceiling", () => {
    for (const attempt of [1, 2, 3, 4, 5]) {
      const ceiling = Math.min(DEFAULT_RETRY.maxDelayMs, DEFAULT_RETRY.baseDelayMs * 2 ** (attempt - 1))
      expect(backoffMs(attempt, DEFAULT_RETRY, () => 1)).toBeLessThanOrEqual(ceiling)
      expect(backoffMs(attempt, DEFAULT_RETRY, () => 0)).toBe(0)
    }
  })

  it("grows with the attempt, which is the point of backing off", () => {
    const full = (attempt: number) => backoffMs(attempt, DEFAULT_RETRY, () => 1)
    expect(full(2)).toBeGreaterThan(full(1))
    expect(full(3)).toBeGreaterThan(full(2))
  })

  it("stops growing at the cap", () => {
    expect(backoffMs(20, DEFAULT_RETRY, () => 1)).toBe(DEFAULT_RETRY.maxDelayMs)
  })

  it("does not synchronize two clients that failed at the same moment", () => {
    expect(backoffMs(3, DEFAULT_RETRY, () => 0.2)).not.toBe(backoffMs(3, DEFAULT_RETRY, () => 0.9))
  })
})
