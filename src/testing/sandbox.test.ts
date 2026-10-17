import { existsSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { systemKeyring } from "../keyring.js"
import { enterSandbox } from "./sandbox.js"

describe("enterSandbox", () => {
  it("points home, temp, XDG and every set app directory at a fresh folder, and removes it", () => {
    const env: NodeJS.ProcessEnv = { HOME: "/home/owner", TG_CONFIG_DIR: "/home/owner/.tg", PATH: "/usr/bin" }
    const first = enterSandbox(env)
    const second = enterSandbox({})

    expect(first.dir).not.toBe(second.dir)
    expect(existsSync(first.dir)).toBe(true)
    for (const key of ["HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "APPDATA", "TG_CONFIG_DIR"])
      expect(env[key]?.startsWith(first.dir)).toBe(true)
    expect(env.PATH).toBe("/usr/bin")

    first.restore()
    second.restore()
    expect(existsSync(first.dir)).toBe(false)
    expect(env).toEqual({ HOME: "/home/owner", TG_CONFIG_DIR: "/home/owner/.tg", PATH: "/usr/bin" })
  })

  it("is already in place for this file through the shared setup", () => {
    expect(tmpdir()).toMatch(/wirecat-test-/)
    expect(homedir().startsWith(tmpdir())).toBe(true)
  })
})

describe("the keyring under the shared setup", () => {
  it("throws on any use of the real keyring", () => {
    expect(() => systemKeyring.get("cli-base-test", "default")).toThrow(/real OS keyring/)
  })
})
