import { describe, expect, it } from "vitest"
import { errorCodes } from "./errors.js"
import { EXIT_CODES, exitCodeFor, GENERIC_FAILURE } from "./exit-codes.js"

describe("exit codes", () => {
  it("covers every error code, so a script never sees an undefined status", () => {
    for (const code of errorCodes) expect(typeof exitCodeFor(code)).toBe("number")
  })

  it("gives each code its own number", () => {
    const numbers = Object.values(EXIT_CODES)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it("never collides with success or with the generic failure", () => {
    for (const code of errorCodes) {
      expect(exitCodeFor(code)).not.toBe(0)
      expect(exitCodeFor(code)).not.toBe(GENERIC_FAILURE)
    }
  })

  it("gives a conflict 15, after outcome_unknown", () => {
    expect(exitCodeFor("conflict")).toBe(15)
  })

  it("uses the shell's own number for an interrupted command", () => {
    expect(exitCodeFor("cancelled")).toBe(130)
  })
})
