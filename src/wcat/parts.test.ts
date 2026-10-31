import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parseDescribe } from "./describe.js"
import { listTools } from "./dispatch.js"
import { binFolder, ensureLauncher } from "./launcher.js"
import { findTools, pathEntries } from "./path.js"
import { parseShim, SHIM_FORMAT, shimFiles } from "./shim.js"
import { addShortcuts, listShortcuts } from "./shortcuts.js"

const folder = () => mkdtempSync(join(tmpdir(), "wcat-parts-"))
const touch = (path: string, text = "") => writeFileSync(path, text, { mode: 0o755 })

describe("the Windows launcher pair", () => {
  it("is a .cmd and a .ps1 that start the tool beside them in dispatch mode, each marked as ours", () => {
    const files = shimFiles("launcher", { dir: "C:\\npm", name: "wcat", target: "wcat-tg.cmd", platform: "win32" })
    expect(files.map((file) => file.path.split(/[\\/]/).pop())).toEqual(["wcat.cmd", "wcat.ps1"])
    const [cmd, ps1] = files.map((file) => file.text)
    expect(cmd).toBe(
      [
        "@ECHO off",
        "REM wirecat-shim 1 launcher wcat-tg.cmd",
        "REM Written by @wirecat/cli-base. Any WireCat tool rewrites it when it breaks; it is safe to delete.",
        '"%~dp0wcat-tg.cmd" --wcat-dispatch %*',
        "",
      ].join("\r\n"),
    )
    expect(ps1).toContain('$stem = Join-Path $PSScriptRoot "wcat-tg"\r\n')
    expect(ps1).toContain(
      '$target = if (Test-Path -LiteralPath "$stem.ps1") { "$stem.ps1" } else { Join-Path $PSScriptRoot "wcat-tg.cmd" }',
    )
    expect(ps1).toContain("$input | & $target --wcat-dispatch @args")
    expect(ps1).toContain("exit $LASTEXITCODE")
    expect(files.map((file) => parseShim(file.text))).toEqual([
      { format: 1, kind: "launcher", target: "wcat-tg.cmd" },
      { format: 1, kind: "launcher", target: "wcat-tg.cmd" },
    ])
  })

  it("is written, kept and refused the same way as the POSIX launcher", () => {
    const dir = folder()
    touch(join(dir, "wcat-tg.cmd"))
    touch(join(dir, "wcat-max.cmd"))
    expect(ensureLauncher({ dir, program: "wcat-tg.cmd", platform: "win32" })).toBe("written")
    expect(ensureLauncher({ dir, program: "wcat-max.cmd", platform: "win32" })).toBe("kept")
    expect(parseShim(readFileSync(join(dir, "wcat.ps1"), "utf8"))?.target).toBe("wcat-tg.cmd")

    touch(join(dir, "wcat.ps1"), "# someone else's\r\n")
    expect(ensureLauncher({ dir, program: "wcat-max.cmd", platform: "win32" })).toBe("foreign")
    expect(readFileSync(join(dir, "wcat.ps1"), "utf8")).toBe("# someone else's\r\n")
  })

  it("counts a tool bun left behind on uninstall as gone, by the script its .bunx names", () => {
    const home = folder()
    const dir = join(home, "bin")
    const script = join(home, "install/global/node_modules/wcat-fixture-a/bin.mjs")
    mkdirSync(dir)
    mkdirSync(join(script, ".."), { recursive: true })
    touch(join(dir, "wcat-a.exe"))
    touch(join(dir, "wcat-b.cmd"))
    const bunx = `..\\..\\elsewhere\\install\\global\\node_modules\\wcat-fixture-a\\bin.mjs"\u0000node`
    writeFileSync(join(dir, "wcat-a.bunx"), Buffer.from(bunx, "utf16le"))
    expect(ensureLauncher({ dir, program: "wcat-a.exe", platform: "win32" })).toBe("written")
    touch(script)
    expect(ensureLauncher({ dir, program: "wcat-b.cmd", platform: "win32" })).toBe("kept")
    rmSync(script)
    expect(ensureLauncher({ dir, program: "wcat-b.cmd", platform: "win32" })).toBe("written")
    expect(parseShim(readFileSync(join(dir, "wcat.cmd"), "utf8"))?.target).toBe("wcat-b.cmd")
  })

  it("makes a shortcut pair that starts the tool without dispatch mode", () => {
    const [cmd] = shimFiles("shortcut", { dir: "C:\\npm", name: "tg", target: "wcat-tg.cmd", platform: "win32" })
    expect(cmd?.text).toContain('"%~dp0wcat-tg.cmd" %*')
    expect(cmd?.text).not.toContain("--wcat-dispatch")
  })
})

describe("the launcher", () => {
  it("leaves one a newer cli-base wrote, and rewrites one in an older shape", () => {
    const dir = folder()
    touch(join(dir, "wcat-tg"))
    const [file] = shimFiles("launcher", { dir, name: "wcat", target: "wcat-tg", platform: "linux" })
    touch(join(dir, "wcat"), file?.text.replace(`wirecat-shim ${SHIM_FORMAT}`, `wirecat-shim ${SHIM_FORMAT + 1}`))
    expect(ensureLauncher({ dir, program: "wcat-tg", platform: "linux" })).toBe("newer")
    touch(join(dir, "wcat"), "#!/bin/sh\n# wirecat-shim 1 launcher wcat-tg\nexec old\n")
    expect(ensureLauncher({ dir, program: "wcat-tg", platform: "linux" })).toBe("written")
    expect(readFileSync(join(dir, "wcat"), "utf8")).toBe(file?.text)
  })

  it("quotes a folder with a quote in its name", () => {
    const [file] = shimFiles("launcher", {
      dir: "/home/o'neil/bin",
      name: "wcat",
      target: "wcat-tg",
      platform: "linux",
    })
    expect(file?.text).toContain(`exec '/home/o'\\''neil/bin/wcat-tg' --wcat-dispatch "$@"`)
  })

  it("reports a folder it may not write instead of failing the tool", () => {
    expect(ensureLauncher({ dir: join(folder(), "missing"), program: "wcat-tg", platform: "linux" })).toBe("failed")
  })
})

describe("the bin folder of a global install", () => {
  const layout = (files: string[]) => {
    const root = folder()
    for (const file of files) {
      mkdirSync(join(root, file, ".."), { recursive: true })
      touch(join(root, file))
    }
    return root
  }

  it("is the folder of the link npm made, on Linux and macOS", () => {
    const root = layout(["bin/wcat-tg"])
    const script = join(root, "lib/node_modules/@wirecat/tg-cli/node_modules/@wirecat/cli-base/dist/wcat/start.js")
    expect(binFolder({ name: "tg", argv1: join(root, "bin/wcat-tg"), script, env: {}, platform: "linux" })).toEqual({
      dir: join(root, "bin"),
      program: "wcat-tg",
    })
    // Started by its short name during the move to wcat- names, npm's prefix layout still finds it.
    expect(binFolder({ name: "tg", argv1: join(root, "bin/tg"), script, env: {}, platform: "linux" })?.dir).toBe(
      join(root, "bin"),
    )
  })

  it("is npm's prefix on Windows, where the .cmd wrapper starts the package's own file", () => {
    const root = layout(["wcat-tg.cmd"])
    const script = join(root, "node_modules/@wirecat/tg-cli/dist/bin/tg.js")
    expect(binFolder({ name: "tg", argv1: script, script, env: {}, platform: "win32" })).toEqual({
      dir: root,
      program: "wcat-tg.cmd",
    })
  })

  it("is PNPM_HOME/bin (pnpm 12) or PNPM_HOME for pnpm's global packages, and nothing for a project's own pnpm folder", () => {
    const home = layout(["wcat-tg"])
    const script = join(home, "global/v11/abc/node_modules/.pnpm/@wirecat+tg-cli@1.0.0/node_modules/x/start.js")
    expect(binFolder({ name: "tg", argv1: script, script, env: { PNPM_HOME: home }, platform: "linux" })?.dir).toBe(
      home,
    )
    const twelve = layout(["bin/wcat-tg"])
    const linked = join(twelve, "store/v11/links/@wirecat/tg-cli/1.0.0/abc/node_modules/@wirecat/tg-cli/dist/bin/tg.js")
    expect(
      binFolder({ name: "tg", argv1: linked, script: linked, env: { PNPM_HOME: twelve }, platform: "linux" })?.dir,
    ).toBe(join(twelve, "bin"))
    const project = join(folder(), "tg-cli/node_modules/.pnpm/@wirecat+cli-base@1.0.0/node_modules/x/start.js")
    expect(
      binFolder({ name: "tg", argv1: project, script: project, env: { PNPM_HOME: home }, platform: "linux" }),
    ).toBe(undefined)
  })

  it("is bun's bin folder for bun's global packages", () => {
    const root = layout(["bin/wcat-tg.exe"])
    const script = join(root, "install/global/node_modules/@wirecat/cli-base/dist/wcat/start.js")
    expect(binFolder({ name: "tg", argv1: script, script, env: {}, platform: "win32" })).toEqual({
      dir: join(root, "bin"),
      program: "wcat-tg.exe",
    })
  })

  it("is nothing for npx, a checkout or a project's node_modules/.bin", () => {
    const root = layout(["node_modules/.bin/wcat-tg"])
    const local = join(root, "node_modules/@wirecat/tg-cli/dist/bin/tg.js")
    const argv1 = join(root, "node_modules/.bin/wcat-tg")
    expect(binFolder({ name: "tg", argv1, script: local, env: {}, platform: "linux" })).toBe(undefined)
    const npx = join(root, ".npm/_npx/abc/node_modules/@wirecat/tg-cli/dist/bin/tg.js")
    expect(binFolder({ name: "tg", argv1: npx, script: npx, env: {}, platform: "linux" })).toBe(undefined)
    const checkout = join(root, "tg-cli/dist/bin/tg.js")
    expect(binFolder({ name: "tg", argv1: checkout, script: checkout, env: {}, platform: "linux" })).toBe(undefined)
  })
})

describe("searching PATH", () => {
  it("counts a folder listed twice once", () => {
    expect(pathEntries({ env: { PATH: "/a:/b/:/a::/b" }, platform: "linux" })).toEqual(["/a", "/b/"])
    expect(pathEntries({ env: { Path: 'C:\\A;"C:\\b";c:\\a\\' }, platform: "win32" })).toEqual(["C:\\A", "C:\\b"])
  })

  it("on Windows, counts wcat-x.cmd, wcat-x.ps1 and wcat-x in one folder as one program", () => {
    const dir = folder()
    for (const file of ["wcat-x.cmd", "wcat-x.ps1", "wcat-x", "WCAT-Y.EXE", "wcat-Bad.txt", "notes.cmd"])
      touch(join(dir, file))
    const tools = findTools({ env: { PATH: dir, PATHEXT: ".EXE;.CMD" }, platform: "win32" })
    expect([...tools]).toEqual([
      ["x", [join(dir, "wcat-x.cmd")]],
      ["y", [join(dir, "WCAT-Y.EXE")]],
    ])
  })

  it.skipIf(process.platform === "win32")("on Linux and macOS, skips files that are not executable", () => {
    const dir = folder()
    touch(join(dir, "wcat-run"))
    writeFileSync(join(dir, "wcat-text"), "", { mode: 0o644 })
    expect([...findTools({ env: { PATH: dir }, platform: "linux" }).keys()]).toEqual(["run"])
  })
})

describe("--wcat-describe answers", () => {
  it("are read from the format's own keys, and anything else is no description", () => {
    expect(
      parseDescribe('{"wcat_describe":1,"version":"2.0.0","description":"x\\u001b[2Jy","docs_url":"https://a.b"}'),
    ).toEqual({
      version: "2.0.0",
      description: "x\\x1b[2Jy",
      docs: "https://a.b",
    })
    expect(parseDescribe('{"wcat_describe":1,"docs_url":"javascript:alert(1)"}')).toEqual({
      version: "",
      description: "",
    })
    expect(parseDescribe('{"version":"1"}')).toBe(undefined)
    expect(parseDescribe("Usage: something")).toBe(undefined)
  })

  it.skipIf(process.platform === "win32")("are waited for only up to the time limit", async () => {
    const dir = folder()
    // Not exec: the sleep is a grandchild that keeps the output open after the child is killed, as node under cmd.exe.
    writeFileSync(join(dir, "wcat-slow"), "#!/bin/sh\nsleep 5\necho late\n", { mode: 0o755 })
    const started = performance.now()
    const tools = await listTools({
      env: { PATH: `${dir}:/usr/bin:/bin` },
      platform: "linux",
      stdout: { write: () => true },
      stderr: { write: () => true },
      describeTimeoutMs: 100,
    })
    expect(performance.now() - started).toBeLessThan(2000)
    expect(tools.find((one) => one.name === "slow")).toEqual({
      name: "slow",
      installed: true,
      path: join(dir, "wcat-slow"),
    })
  })
})

describe("shortcuts as a library", () => {
  it("refuses a tool that is not installed before changing anything", () => {
    const dir = folder()
    touch(join(dir, "wcat-x"))
    const search = { env: { PATH: dir }, platform: "linux" as const }
    expect(() => addShortcuts(search, ["x", "nope"])).toThrow(/not installed: wcat-nope/)
    expect(listShortcuts(search)).toEqual([{ name: "x", status: "free", program: join(dir, "wcat-x") }])
  })
})
