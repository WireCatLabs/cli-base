import { lstatSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as v from "valibot"
import { describe, expect, it, vi } from "vitest"
import { loadConfigFile, saveConfigFile, writeSecurely } from "./config.js"

const Schema = v.object({ version: v.literal(1), profiles: v.optional(v.record(v.string(), v.object({}))) })
const empty = () => ({ version: 1 as const })
const dir = () => mkdtempSync(join(tmpdir(), "cli-base-"))

describe("loadConfigFile", () => {
  it("treats a missing file as unconfigured, not as broken", () => {
    expect(loadConfigFile(join(dir(), "config.json"), Schema, empty)).toEqual({ version: 1 })
  })

  it("names the file when the JSON itself is malformed", () => {
    const path = join(dir(), "config.json")
    writeSecurely(path, "{ not json", 0o644)
    expect(() => loadConfigFile(path, Schema, empty)).toThrow(/is not valid JSON/)
  })

  it("names the field and the reason when validation fails", () => {
    const path = join(dir(), "config.json")
    saveConfigFile(path, { version: 2 })
    expect(() => loadConfigFile(path, Schema, empty)).toThrow(/version/)
  })

  it("round-trips what it saved", () => {
    const path = join(dir(), "config.json")
    saveConfigFile(path, { version: 1, profiles: { default: {} } })
    expect(loadConfigFile(path, Schema, empty)).toEqual({ version: 1, profiles: { default: {} } })
  })
})

describe("writeSecurely", () => {
  it("applies the mode it was given", () => {
    const path = join(dir(), "nested", "credentials.json")
    writeSecurely(path, "{}", 0o600)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, "utf8")).toBe("{}")
  })

  it("locks down the directory it creates, not only the file", () => {
    const path = join(dir(), "nested", "credentials.json")
    writeSecurely(path, "{}", 0o600)
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700)
  })

  it("does not write through a symlink planted at a predictable temporary name", () => {
    const base = dir()
    const target = join(base, "elsewhere")
    writeFileSync(target, "untouched")
    vi.spyOn(Date, "now").mockReturnValue(1)
    symlinkSync(target, join(base, `.1-${process.pid}.tmp`))

    writeSecurely(join(base, "config.json"), "{}", 0o600)
    vi.restoreAllMocks()

    expect(readFileSync(target, "utf8")).toBe("untouched")
    expect(lstatSync(join(base, "config.json")).isFile()).toBe(true)
  })

  it("leaves no temporary file behind", () => {
    const base = dir()
    writeSecurely(join(base, "config.json"), "{}", 0o644)
    expect(readFileSync(join(base, "config.json"), "utf8")).toBe("{}")
  })
})
