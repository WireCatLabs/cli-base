import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as v from "valibot"
import { describe, expect, it } from "vitest"
import type { Logger } from "./logger.js"
import { createRecordLog, NOT_ALLOWED, type RecordLogOptions } from "./logging.js"
import { defineLogEvents, logRecordSchema } from "./standards/log.js"
import { expectRegisteredEvents } from "./testing/index.js"

const logFile = () => join(mkdtempSync(join(tmpdir(), "cli-base-log-")), "events.jsonl")

const base = {
  runId: "20261013T080000Z-chats-list-a81f2c",
  command: "chats list",
  resource: { service: "tg", version: "1.2.3" },
  now: () => new Date("2026-10-13T08:00:00.000Z"),
}

const written = (write: (log: Logger) => void, options: Partial<RecordLogOptions> = {}) => {
  const path = logFile()
  write(createRecordLog({ ...base, to: path, ...options }))
  return readFileSync(path, "utf8")
}

const records = (text: string) =>
  text
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown)

describe("createRecordLog", () => {
  it("writes one record per line, each valid against the log record schema", () => {
    const text = written((log) => {
      log.info({ event: "request", operation: "chats.list" })
      log.warn({ event: "warning", code: "slow" })
      log.error({ event: "crash", frames: [] }, "crashed")
    })

    const lines = records(text)
    expect(lines).toHaveLength(3)
    for (const line of lines) expect(v.parse(logRecordSchema, line)).toEqual(line)
    expect(lines[0]).toEqual({
      time: "2026-10-13T08:00:00.000Z",
      severity: "info",
      body: "request",
      run_id: base.runId,
      command: "chats list",
      attributes: { event: "request", operation: "chats.list" },
      resource: { service: "tg", version: "1.2.3" },
    })
    expect(lines.map((line) => (line as { severity: string }).severity)).toEqual(["info", "warn", "error"])
    expect((lines[2] as { body: string }).body).toBe("crash")
    expect(text).not.toContain("crashed")
  })

  it("carries a trace id when one was handed in", () => {
    const [line] = records(written((log) => log.info({ event: "x" }), { traceId: "0af7651916cd43dd8448eb211c80319c" }))
    expect(v.parse(logRecordSchema, line)).toMatchObject({ trace_id: "0af7651916cd43dd8448eb211c80319c" })
  })

  it("redacts a secret by field name at any depth, arrays included", () => {
    const text = written(
      (log) =>
        log.info({
          token: "t0ken",
          nested: { password: "hunter2" },
          deep: { a: { b: { access_token: "leak" } } },
          list: [{ secret: "s3" }],
        }),
      { allow: ["nested", "deep", "list"] },
    )

    for (const secret of ["t0ken", "hunter2", "leak", "s3"]) expect(text).not.toContain(secret)
    expect(text).toContain("[redacted]")
  })

  it("redacts a key that names content at any depth: a title, a message's text, a phone number", () => {
    const text = written(
      (log) => log.info({ event: "x", ids: { chatTitle: "Family", chat: "42" }, errorMessage: "quoted payload" }),
      { allow: ["ids", "errorMessage"] },
    )
    for (const content of ["Family", "quoted payload"]) expect(text).not.toContain(content)
    expect(text).toContain('"chat":"42"')
  })

  it("writes a top-level key off the allow-list without its value", () => {
    const [line] = records(written((log) => log.info({ event: "x", operation: "chats.list", chat: "Family" })))
    expect(line).toMatchObject({ attributes: { event: "x", operation: "chats.list", chat: NOT_ALLOWED } })
    expect(records(written((log) => log.info({ event: "x", chat: "42" }), { allow: ["chat"] }))[0]).toMatchObject({
      attributes: { chat: "42" },
    })
  })

  it("redacts the names this program adds, on top of the defaults", () => {
    const text = written((log) => log.info({ deviceId: "device-1" }), { redact: ["deviceId"], allow: ["deviceId"] })
    expect(text).not.toContain("device-1")
  })

  it("keeps a phone number and a verification code out of the file", () => {
    const text = written((log) => log.info({ phone: "+34600000000", verifyCode: "123456" }))
    expect(text).not.toContain("+34600000000")
    expect(text).not.toContain("123456")
  })

  it("creates the file readable by its owner only", () => {
    const path = logFile()
    createRecordLog({ ...base, to: path }).info({ event: "x" })
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it("hands each line to a function without its newline", () => {
    const lines: string[] = []
    createRecordLog({ ...base, to: (line) => lines.push(line) }).warn({ event: "warning" }, "a rule failed")
    expect(lines).toHaveLength(1)
    expect(v.parse(logRecordSchema, JSON.parse(lines[0] as string))).toMatchObject({ body: "warning" })
  })

  it("names each record by a registered event, and fails a test that logs one it does not know", () => {
    const events = defineLogEvents([
      { id: "provider.request.failed", meaning: "the provider refused a request", keys: ["status"] },
    ])
    const lines: string[] = []
    const log = createRecordLog({ ...base, to: (line) => lines.push(line) })
    log.warn({ event: "provider.request.failed", status: 503 })
    expect(() => expectRegisteredEvents(lines, events)).not.toThrow()
    log.warn({ event: "provider.request.failed" })
    log.info({ event: "request" })
    expect(() => expectRegisteredEvents(lines, events)).toThrow(
      'provider.request.failed: no "status" attribute\n"request" is not a registered log event',
    )
  })

  it("writes nowhere at all when given no destination", () => {
    expect(() => createRecordLog(base).info({ event: "ignored" })).not.toThrow()
  })

  it("survives a file it cannot write, and says so once", () => {
    const errors: Error[] = []
    const path = join(mkdtempSync(join(tmpdir(), "cli-base-log-")), "gone", "events.jsonl")
    const log = createRecordLog({ ...base, to: path, onError: (error) => errors.push(error) })

    log.info({ event: "first" })
    log.info({ event: "second" })

    expect(errors.map((error) => (error as NodeJS.ErrnoException).code)).toEqual(["ENOENT"])
  })
})
