import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import * as v from "valibot"
import { describe, expect, it } from "vitest"
import { BASE_CONSTANTS, baseConstantsSchema, loadConstants } from "./constants.js"

const Schema = v.object({
  ...baseConstantsSchema.entries,
  google: v.object({ app: v.object({ client_id: v.string(), client_secret: v.optional(v.string()) }) }),
  scopes: v.array(v.string()),
})

const layer = (dir: string, name: string, value: unknown) => {
  const path = join(dir, `${name}.json`)
  writeFileSync(path, JSON.stringify(value))
  return pathToFileURL(path)
}

describe("loadConstants", () => {
  it("merges objects key by key, a later layer winning, and replaces arrays whole", () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-base-"))
    const core = layer(dir, "core", { google: { app: { client_id: "core", client_secret: "s" } }, scopes: ["a", "b"] })
    const tool = layer(dir, "tool", { google: { app: { client_id: "tool" } }, scopes: ["c"] })

    expect(loadConstants([BASE_CONSTANTS, core, tool], Schema)).toEqual({
      google: { app: { client_id: "tool", client_secret: "s" } },
      scopes: ["c"],
    })
  })

  it("reads a tool layer that does not exist as empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-base-"))
    const core = layer(dir, "core", { google: { app: { client_id: "core" } }, scopes: [] })

    expect(loadConstants([BASE_CONSTANTS, core, pathToFileURL(join(dir, "missing.json"))], Schema)).toEqual({
      google: { app: { client_id: "core" } },
      scopes: [],
    })
  })

  it("names the dotted path and the file that set a bad value, or the files when none did", () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-base-"))
    const core = layer(dir, "core", { google: { app: { client_id: 42 } } })

    expect(() => loadConstants([core], Schema)).toThrow(
      new RegExp(`google\\.app\\.client_id: .*set in ${join(dir, "core.json")}[\\s\\S]*scopes: .*not set in`),
    )
  })

  it("freezes the result all the way down", () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-base-"))
    const constants = loadConstants(
      [layer(dir, "core", { google: { app: { client_id: "x" } }, scopes: ["a"] })],
      Schema,
    )

    expect(Object.isFrozen(constants.google.app)).toBe(true)
    expect(() => constants.scopes.push("b")).toThrow(TypeError)
  })
})
