import { describe, expect, it, vi } from "vitest"
import { CliError, errorCodes, isCliError } from "./errors.js"

describe("error model", () => {
  it("keeps the code list unique", () => {
    expect(new Set(errorCodes).size).toBe(errorCodes.length)
  })

  it("carries the code and details an agent branches on", () => {
    const error = new CliError("rate_limited", "slow down", { status: 429, retryAfterMs: 1200 })

    expect(error.code).toBe("rate_limited")
    expect(error.details.retryAfterMs).toBe(1200)
    expect(error).toBeInstanceOf(Error)
  })

  it("recognises an error from a second copy of the package, where instanceof cannot", async () => {
    vi.resetModules()
    const other = await import("./errors.js")
    const foreign = new other.CliError("timeout", "too slow")

    expect(other.CliError).not.toBe(CliError)
    expect(foreign instanceof CliError).toBe(false)
    expect(isCliError(foreign)).toBe(true)
  })

  it("does not take an error that only looks like one", () => {
    expect(isCliError(Object.assign(new Error("x"), { code: "timeout", details: {} }))).toBe(false)
    expect(isCliError(null)).toBe(false)
    expect(isCliError("timeout")).toBe(false)
  })
})
