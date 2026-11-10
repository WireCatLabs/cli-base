import { mkdtempSync, symlinkSync } from "node:fs"
import { homedir, tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { isMovedRun, pathsAreOverridden, refuseOwnerHomeInTests, resolvePaths } from "./paths.js"

describe("resolvePaths", () => {
  it("derives the environment variable names from the app name", () => {
    const paths = resolvePaths({ appName: "max-cli", env: { MAX_CLI_CONFIG_DIR: "/tmp/cfg" } })
    expect(paths.config).toBe("/tmp/cfg")
  })

  it("takes an explicit prefix when the app name makes an awkward variable", () => {
    const paths = resolvePaths({ appName: "max-cli", prefix: "MAX", env: { MAX_STATE_DIR: "/tmp/state" } })
    expect(paths.state).toBe("/tmp/state")
  })

  it("falls back to the OS convention, and the three directories differ", () => {
    const paths = resolvePaths({ appName: "max-cli", env: {} })
    expect(paths.config).toContain("max-cli")
    expect(new Set([paths.config, paths.state, paths.cache]).size).toBe(3)
  })

  it("reports whether anything was overridden, which is what scopes the keyring", () => {
    expect(pathsAreOverridden({ appName: "max-cli", env: {} })).toBe(false)
    expect(pathsAreOverridden({ appName: "max-cli", env: { MAX_CLI_CACHE_DIR: "/tmp/c" } })).toBe(true)
  })

  it.each(["linux", "darwin"] as const)("gives the XDG layout under HOME on %s", (platform) => {
    expect(resolvePaths({ appName: "tg-cli", platform, env: { HOME: "/home/alice" } })).toEqual({
      config: "/home/alice/.config/tg-cli",
      state: "/home/alice/.local/share/tg-cli",
      cache: "/home/alice/.cache/tg-cli",
    })
  })

  it("reads the XDG variables from the env it is given, not the global one", () => {
    const env = { HOME: "/home/alice", XDG_CONFIG_HOME: "/x/config", XDG_DATA_HOME: "/x/data", XDG_CACHE_HOME: "" }
    expect(resolvePaths({ appName: "tg-cli", platform: "darwin", env })).toEqual({
      config: "/x/config/tg-cli",
      state: "/x/data/tg-cli",
      cache: "/home/alice/.cache/tg-cli",
    })
  })

  it("keeps the Windows layout env-paths gave", () => {
    const env = { APPDATA: "C:\\Users\\alice\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" }
    expect(resolvePaths({ appName: "tg-cli", platform: "win32", env })).toEqual({
      config: "C:\\Users\\alice\\AppData\\Roaming\\tg-cli\\Config",
      state: "C:\\Users\\alice\\AppData\\Local\\tg-cli\\Data",
      cache: "C:\\Users\\alice\\AppData\\Local\\tg-cli\\Cache",
    })
    expect(resolvePaths({ appName: "tg-cli", platform: "win32", env: { USERPROFILE: "C:\\Users\\bob" } }).config).toBe(
      "C:\\Users\\bob\\AppData\\Roaming\\tg-cli\\Config",
    )
  })

  it.each(["linux", "darwin", "win32"] as const)("lets the overrides win on %s", (platform) => {
    const env = { HOME: "/home/alice", TG_CONFIG_DIR: "/o/c", TG_STATE_DIR: "/o/s", TG_CACHE_DIR: "/o/k" }
    expect(resolvePaths({ appName: "tg-cli", prefix: "TG", platform, env })).toEqual({
      config: "/o/c",
      state: "/o/s",
      cache: "/o/k",
    })
  })
})

describe("isMovedRun", () => {
  const home = "/home/alice"
  const moved = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform = "linux") =>
    isMovedRun({ appName: "gcal-cli", prefix: "GCAL", env, platform, home })

  it("is false for the owner's own folders, XDG set to its default included", () => {
    expect(moved({ HOME: home })).toBe(false)
    expect(moved({ HOME: `${home}/`, XDG_CONFIG_HOME: `${home}/.config` })).toBe(false)
  })

  it("is true for a folder override, a throwaway HOME or a moved XDG folder", () => {
    expect(moved({ HOME: home, GCAL_STATE_DIR: "/tmp/s" })).toBe(true)
    expect(moved({ HOME: "/tmp/x" })).toBe(true)
    expect(moved({ HOME: home, XDG_DATA_HOME: "/tmp/data" })).toBe(true)
  })

  it("compares Windows folders with the account's own", () => {
    const winHome = "C:\\Users\\alice"
    const win = (env: NodeJS.ProcessEnv) => isMovedRun({ appName: "gcal-cli", env, platform: "win32", home: winHome })
    expect(win({ USERPROFILE: winHome, APPDATA: `${winHome}\\AppData\\Roaming` })).toBe(false)
    expect(win({ USERPROFILE: "C:\\Temp\\x" })).toBe(true)
  })
})

describe("the owner's home under vitest", () => {
  const test = { VITEST: "true" }
  const alice = () => "/home/alice"

  it("is refused to a test, with a trailing slash too, and through resolvePaths", () => {
    expect(() => refuseOwnerHomeInTests({ ...test, HOME: "/home/alice/" }, "linux", alice)).toThrow(/owner's real home/)
    const real = { ...test, HOME: userInfo().homedir, XDG_DATA_HOME: "/elsewhere", TG_STATE_DIR: "/elsewhere/tg" }
    expect(() => resolvePaths({ appName: "tg-cli", prefix: "TG", env: real, platform: "linux" })).toThrow(
      /owner's real home/,
    )
  })

  it.skipIf(process.platform === "win32")("is refused through a symlink to it", () => {
    const owner = mkdtempSync(join(tmpdir(), "owner-"))
    const link = join(tmpdir(), `link-${Date.now()}`)
    symlinkSync(owner, link)
    expect(() => refuseOwnerHomeInTests({ ...test, HOME: link }, "linux", () => owner)).toThrow(/owner's real home/)
  })

  it("checks HOME and USERPROFILE both, and the process's own home when the env names neither", () => {
    expect(() =>
      refuseOwnerHomeInTests({ ...test, HOME: "/tmp/x", USERPROFILE: "/home/alice" }, "linux", alice),
    ).toThrow()
    expect(() => refuseOwnerHomeInTests({}, "linux", () => homedir())).toThrow(/owner's real home/)
    expect(() => refuseOwnerHomeInTests({}, "linux", alice)).not.toThrow()
  })

  it("is left alone outside tests, for a moved HOME, and without an account home", () => {
    expect(() => refuseOwnerHomeInTests({ HOME: "/home/alice" }, "linux", alice)).not.toThrow()
    expect(() => refuseOwnerHomeInTests({ ...test, HOME: "/home/alice/sandbox" }, "linux", alice)).not.toThrow()
    expect(() => refuseOwnerHomeInTests({ ...test, HOME: "/home/alice" }, "linux", () => undefined)).not.toThrow()
    expect(resolvePaths({ appName: "tg-cli", env: { HOME: userInfo().homedir } }).config).toContain("tg-cli")
  })

  it("reads USERPROFILE on Windows", () => {
    const owner = () => "C:\\Users\\alice"
    expect(() => refuseOwnerHomeInTests({ ...test, USERPROFILE: "C:\\Users\\alice" }, "win32", owner)).toThrow()
    expect(() => refuseOwnerHomeInTests({ ...test, USERPROFILE: "C:\\Temp\\x" }, "win32", owner)).not.toThrow()
  })
})
