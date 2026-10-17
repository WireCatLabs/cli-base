import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
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

  it("turns off npm's and pnpm's update check, which would reach the registry from a child process", () => {
    const env: NodeJS.ProcessEnv = {}
    const sandbox = enterSandbox(env)
    expect(env.npm_config_update_notifier).toBe("false")
    expect(env.NO_UPDATE_NOTIFIER).toBe("1")
    sandbox.restore()
    expect(env).toEqual({})
  })

  it("on macOS starts from /tmp, so a socket under the sandboxed home fits in 104 bytes", () => {
    const env: NodeJS.ProcessEnv = {}
    const sandbox = enterSandbox(env, "darwin")
    expect(sandbox.dir.startsWith("/tmp/wirecat-test-")).toBe(true)
    // macOS resolves /tmp to /private/tmp, eight bytes longer.
    const socket = join("/private", env.HOME ?? "", ".local", "state", "tg-cli", "daemon.sock")
    expect(Buffer.byteLength(socket)).toBeLessThan(104)
    sandbox.restore()
  })

  it("elsewhere starts from the temporary folder", () => {
    const sandbox = enterSandbox({}, "linux")
    expect(sandbox.dir.startsWith(tmpdir())).toBe(true)
    sandbox.restore()
  })

  it("removes the folder when a test file fails while loading or in its own afterAll", () => {
    const parent = join(tmpdir(), "child-run")
    mkdirSync(parent)
    const vitest = fileURLToPath(new URL("../../node_modules/vitest/vitest.mjs", import.meta.url))
    const config = fileURLToPath(new URL("../../test/fixtures/sandbox-left/vitest.config.ts", import.meta.url))
    const run = spawnSync(process.execPath, [vitest, "run", "--config", config], {
      env: { ...process.env, TMPDIR: parent, TMP: parent, TEMP: parent },
      encoding: "utf8",
    })

    expect(run.status).toBe(1)
    expect(run.stdout + run.stderr).toMatch(/fails while loading/)
    expect(run.stdout + run.stderr).toMatch(/afterAll fails/)
    expect(readdirSync(parent).filter((name) => name.startsWith("wirecat-test-"))).toEqual([])
  }, 30_000)

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
