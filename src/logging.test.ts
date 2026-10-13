import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as v from "valibot"
import { describe, expect, it } from "vitest"
import type { Logger } from "./logger.js"
import { createRecordLog, type RecordLogOptions } from "./logging.js"
import { logRecordSchema } from "./standards/log.js"

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
    expect((lines[2] as { body: string }).body).toBe("crashed")
  })

  it("carries a trace id when one was handed in", () => {
    const [line] = records(written((log) => log.info({ event: "x" }), { traceId: "0af7651916cd43dd8448eb211c80319c" }))
    expect(v.parse(logRecordSchema, line)).toMatchObject({ trace_id: "0af7651916cd43dd8448eb211c80319c" })
  })

  it("redacts a secret by field name at any depth, arrays included", () => {
    const text = written((log) =>
      log.info({
        token: "t0ken",
        nested: { password: "hunter2" },
        deep: { a: { b: { access_token: "leak" } } },
        list: [{ secret: "s3" }],
      }),
    )

    for (const secret of ["t0ken", "hunter2", "leak", "s3"]) expect(text).not.toContain(secret)
    expect(text).toContain("[redacted]")
  })

  it("redacts the names this program adds, on top of the defaults", () => {
    const text = written((log) => log.info({ deviceId: "device-1" }), { redact: ["deviceId"] })
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
    expect(v.parse(logRecordSchema, JSON.parse(lines[0] as string))).toMatchObject({ body: "a rule failed" })
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
