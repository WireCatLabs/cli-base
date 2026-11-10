import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { homedir, tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { systemKeyring } from "../keyring.js"
import { enterSandbox, removed, takeKeyringReach } from "./sandbox.js"

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

  it("removes the folder when a file fails while loading or in its afterAll, and not when one imitates SIGTERM", () => {
    const parent = join(tmpdir(), "child-run")
    mkdirSync(parent)
    const vitest = fileURLToPath(new URL("../../node_modules/vitest/vitest.mjs", import.meta.url))
    const config = fileURLToPath(new URL("../../test/fixtures/sandbox-left/vitest.config.ts", import.meta.url))
    const run = spawnSync(process.execPath, [vitest, "run", "--reporter=verbose", "--config", config], {
      // CI sets FORCE_COLOR; colour codes would split the reporter's lines this test reads.
      env: { ...process.env, TMPDIR: parent, TMP: parent, TEMP: parent, NO_COLOR: "1", FORCE_COLOR: "0" },
      encoding: "utf8",
    })

    expect(run.status).toBe(1)
    expect(run.stdout + run.stderr).toMatch(/fails while loading/)
    expect(run.stdout + run.stderr).toMatch(/afterAll fails/)
    expect(run.stdout + run.stderr).toMatch(/✓ emits-sigterm\.test\.ts > keeps its sandbox and its worker/)
    expect(readdirSync(parent).filter((name) => name.startsWith("wirecat-test-"))).toEqual([])
  }, 30_000)

  it("is already in place for this file through the shared setup", () => {
    expect(tmpdir()).toMatch(/wirecat-test-/)
    expect(homedir().startsWith(tmpdir())).toBe(true)
  })
})

describe("a vitest run from outside the repository, which loads no setup", () => {
  const source = (path: string) => JSON.stringify(pathToFileURL(fileURLToPath(new URL(path, import.meta.url))).href)

  // The child gets the account's real HOME, as the 2026-10-26 probe had, so it only resolves paths and never writes.
  it("refuses the owner's folders and keyring instead of returning them", () => {
    const root = join(tmpdir(), "outside-root")
    mkdirSync(root, { recursive: true })
    writeFileSync(
      join(root, "probe.test.ts"),
      [
        'import { expect, it } from "vitest"',
        `import { systemKeyring } from ${source("../keyring.ts")}`,
        `import { resolvePaths } from ${source("../paths.ts")}`,
        `import { hermesHome, skillPath } from ${source("../skill/index.ts")}`,
        'it("probe", () => {',
        "  expect(process.env.HOME).not.toMatch(/wirecat-test-/)",
        '  expect(() => resolvePaths({ appName: "wirecat-guard-probe" })).toThrow(/owner.s real home/)',
        '  expect(() => skillPath("claude", "wirecat-guard-probe", process.env)).toThrow(/owner.s real home/)',
        "  expect(() => hermesHome(process.env)).toThrow(/owner.s real home/)",
        '  expect(() => systemKeyring.get("wirecat-guard-probe", "x")).toThrow(/owner.s real home/)',
        "})",
      ].join("\n"),
    )
    // The sandbox's XDG folders, overrides and a HERMES_HOME stay: the real HOME alone must be refused.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")))
    const vitest = fileURLToPath(new URL("../../node_modules/vitest/vitest.mjs", import.meta.url))
    const run = spawnSync(process.execPath, [vitest, "run", "--root", root, "--reporter=verbose"], {
      env: {
        ...env,
        HOME: userInfo().homedir,
        HERMES_HOME: join(root, "hermes"),
        DBUS_SESSION_BUS_ADDRESS: "disabled:",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
      encoding: "utf8",
      timeout: 25_000,
    })

    expect(run.stdout + run.stderr).toMatch(/✓ probe\.test\.ts > probe/)
    expect(run.status).toBe(0)
  }, 30_000)
})

describe("the keyring under the shared setup", () => {
  it("still records the reach when a test puts the owner's real HOME back", () => {
    vi.stubEnv("HOME", userInfo().homedir)
    try {
      expect(() => systemKeyring.get("cli-base-test", "default")).toThrow(/real OS keyring/)
    } finally {
      vi.unstubAllEnvs()
    }
    expect(takeKeyringReach()).toMatch(/real OS keyring/)
  })

  it("throws on any use of the real keyring, and records it for the after-each check", () => {
    expect(() => systemKeyring.get("cli-base-test", "default")).toThrow(/real OS keyring/)
    expect(takeKeyringReach()).toMatch(/real OS keyring[\s\S]*sandbox\.test\.ts/)
    expect(takeKeyringReach()).toBeUndefined()
  })
})

describe("removed", () => {
  const failing = (code: string) => () => {
    throw Object.assign(new Error(code), { code })
  }

  it("leaves a folder Windows still holds open instead of failing the test file", () => {
    expect(removed("/tmp/wirecat-test-held", 1, failing("EPERM") as never)).toBe(false)
    expect(removed("/tmp/wirecat-test-busy", 1, failing("EBUSY") as never)).toBe(false)
  })

  it("still throws any other error", () => {
    expect(() => removed("/tmp/wirecat-test-x", 1, failing("EACCES") as never)).toThrow("EACCES")
  })
})
