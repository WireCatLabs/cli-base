import * as v from "valibot"
import { describe, expect, it } from "vitest"
import { CliError, type errorCodes } from "./errors.js"
import { catchCrashes, errorObjectOf, errorRecordOf, exitCodeOfError, mcpErrorResult, renderError } from "./failure.js"
import { BASE_REASONS, defineReasons, defineSteps, errorObjectSchema } from "./standards/index.js"

const reasons = defineReasons([
  {
    reason: "store.locked",
    code: "configuration_error",
    message: "{path} is locked",
    details: ["path"],
    step: "store.unlock",
  },
])
const steps = defineSteps([
  { id: "store.unlock", command: "store unlock", args: [{ name: "path", required: true }], why: "{path} stays locked" },
])

describe("errorObjectOf", () => {
  it("builds a valid object for every base reason, the same on the CLI and MCP", () => {
    for (const base of BASE_REASONS.filter((entry) => entry.code !== "internal_error")) {
      const object = errorObjectOf(
        new CliError(base.code as (typeof errorCodes)[number], "went wrong", { reason: base.reason }),
        { runId: "r1" },
      )
      expect(v.is(errorObjectSchema, object)).toBe(true)
      expect(object.error.reason).toBe(base.reason)
      expect(JSON.parse(renderError(object, { cli: "max", interactive: false }))).toEqual(
        mcpErrorResult(object).structuredContent,
      )
    }
  })

  it("falls back to the code's reason when the site named none or an unknown one", () => {
    expect(errorObjectOf(new CliError("not_found", "no chat 42")).error.reason).toBe("item.not-found")
    expect(errorObjectOf(new CliError("timeout", "slow", { reason: "query_limit" })).error.reason).toBe(
      "command.timed-out",
    )
  })

  it("keeps only registered details and never the cause", () => {
    const object = errorObjectOf(
      new CliError("configuration_error", "locked", {
        reason: "store.locked",
        path: "/tmp/store",
        cause: "SQLITE_BUSY: database is locked",
        retryable: true,
        chatTitle: "Mum",
        param: "store",
      }),
      { reasons, steps },
    )
    expect(object.error).toEqual({
      code: "configuration_error",
      reason: "store.locked",
      message: "locked",
      param: "store",
      details: { path: "/tmp/store", retryable: true },
      next: [
        { step: "store.unlock", command: "store unlock", args: { path: "/tmp/store" }, why: "/tmp/store stays locked" },
      ],
    })
  })

  it("chooses the next step by reason, and drops it when a required argument is missing", () => {
    const object = errorObjectOf(new CliError("configuration_error", "locked", { reason: "store.locked" }), {
      reasons,
      steps,
    })
    expect(object.error.next).toBeUndefined()
  })

  it("never shows the text of an error it did not raise itself", () => {
    const object = errorObjectOf(new Error("SQLITE_CORRUPT near 'hello mum'"), { runId: "r9" })
    expect(object).toEqual({
      error: {
        code: "internal_error",
        reason: "command.crashed",
        message: "the command failed; this is a bug",
        runId: "r9",
      },
    })
    expect(exitCodeOfError(object)).toBe(1)
  })

  it("recognises an error from a cli-base copy that predates the brand", () => {
    const old = Object.assign(new Error("no such chat"), {
      name: "CliError",
      code: "not_found",
      details: { status: 404 },
    })
    const object = errorObjectOf(old)
    expect(object.error).toMatchObject({ code: "not_found", message: "no such chat", details: { status: 404 } })
    expect(exitCodeOfError(object)).toBe(6)
  })
})

describe("renderError", () => {
  const object = errorObjectOf(
    new CliError("configuration_error", "store is locked", { reason: "store.locked", path: "/tmp/s" }),
    { reasons, steps, runId: "r1" },
  )

  it("gives a person the message, one next step and where to dig", () => {
    expect(renderError(object, { cli: "max", interactive: true })).toBe(
      [
        "✗ store is locked",
        '→ /tmp/s stays locked: max store unlock --path "/tmp/s"',
        "details: max runs show r1",
      ].join("\n"),
    )
  })

  it("prints no details line without a run id", () => {
    const bare = errorObjectOf(new CliError("not_found", "no chat 42"))
    expect(renderError(bare, { cli: "tg", interactive: true })).toBe("✗ no chat 42")
  })

  it("shows the record, with cause and stack, only under --debug", () => {
    const failure = new CliError("configuration_error", "store is locked", {
      reason: "store.locked",
      path: "/tmp/s",
      cause: "SQLITE_BUSY",
    })
    const plain = renderError(object, { cli: "max", interactive: true })
    expect(plain).not.toMatch(/SQLITE_BUSY|at /)
    const record = errorRecordOf(failure, errorObjectOf(failure, { reasons, steps, runId: "r1" }), {
      command: "messages list",
      service: "max",
      version: "1.0.0",
      time: new Date("2026-10-13T10:00:00Z"),
    })
    expect(record).toMatchObject({
      time: "2026-10-13T10:00:00.000Z",
      severity: "error",
      runId: "r1",
      command: "messages list",
      attributes: { code: "configuration_error", reason: "store.locked", cause: "SQLITE_BUSY" },
    })
    expect(record.attributes.stack).toEqual(expect.arrayContaining([expect.stringMatching(/^at /)]))
    const debug = renderError(object, { cli: "max", interactive: true, record })
    expect(debug).toContain("SQLITE_BUSY")
    expect(debug).not.toContain("details: max runs show")
    const machine = renderError(object, { cli: "max", interactive: false, record }).split("\n")
    expect(JSON.parse(machine[0] ?? "")).toEqual(object)
    expect(JSON.parse(machine[1] ?? "").attributes.cause).toBe("SQLITE_BUSY")
  })
})

describe("catchCrashes", () => {
  it("reports a throw outside the handler as the error object and exits", () => {
    const listeners = new Map<string, (failure: unknown) => void>()
    const target = {
      on: (event: string, listener: (failure: unknown) => void) => listeners.set(event, listener),
      off: (event: string) => listeners.delete(event),
    } as unknown as Pick<NodeJS.Process, "on" | "off">
    const written: string[] = []
    const exits: number[] = []
    const release = catchCrashes({
      cli: "memo",
      interactive: false,
      target,
      write: (text) => written.push(text),
      exit: (code) => exits.push(code),
    })
    listeners.get("uncaughtException")?.(new Error("migration failed for /home/x"))
    listeners.get("unhandledRejection")?.(new CliError("permission_error", "read only"))
    expect(written.map((line) => JSON.parse(line).error.code)).toEqual(["internal_error", "permission_error"])
    expect(written.join("")).not.toContain("/home/x")
    expect(exits).toEqual([1, 5])
    release()
    expect(listeners.size).toBe(0)
  })
})
