import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as v from "valibot"
import { beforeEach, describe, expect, it } from "vitest"
import { listEnvelopeSchema } from "../standards/output.js"
import { runWcat, type WcatContext } from "./dispatch.js"
import { parseShim } from "./shim.js"
import { wcatStart } from "./start.js"

let bin: string
let other: string
let out: string
let err: string

const tool = (dir: string, name: string, body: string) =>
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })

const describing = (name: string, extra = "") =>
  `if [ "$1" = "--wcat-describe" ]; then echo '{"wcat_describe":1,"name":"${name}","version":"2.1.0","description":"the ${name} tool"}'; exit 0; fi\n${extra}`

const context = (dirs = [bin, other]): WcatContext => ({
  // Only the test's own folders: the scripts need nothing from PATH, and a real wcat-* must never be listed or changed.
  env: { PATH: dirs.join(":") },
  platform: "linux",
  stdout: { write: (text: string) => (out += text) },
  stderr: { write: (text: string) => (err += text), isTTY: true },
  self: { command: "alpha", version: "1.0.0", description: "the alpha tool" },
  describeTimeoutMs: 2000,
})

const wcat = (args: string[], dirs?: string[]) => runWcat(args, context(dirs))

describe.skipIf(process.platform === "win32")("wcat's own commands", () => {
  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "wcat-dispatch-"))
    bin = join(root, "bin")
    other = join(root, "other")
    mkdirSync(bin)
    mkdirSync(other)
    tool(bin, "wcat-alpha", 'echo "alpha must not be started to describe itself"; exit 1')
    tool(bin, "wcat-beta", describing("beta", "exit 3"))
    tool(other, "wcat-gamma", "echo not json")
    out = ""
    err = ""
  })

  it("lists installed tools, the running one from its own metadata, and the missing WireCat ones", async () => {
    expect(await wcat([])).toBe(0)
    expect(out).toMatch(/^ {2}alpha +1\.0\.0 +the alpha tool$/m)
    expect(out).toMatch(/^ {2}beta +2\.1\.0 +the beta tool$/m)
    expect(out).toMatch(/^ {2}gamma +\(no description\)$/m)
    expect(out).toMatch(/^Not installed:\n {2}tg +npm install -g @wirecat\/tg-cli$/m)
    expect(out).not.toMatch(/^ {2}email/m)

    out = ""
    expect(await wcat(["--help", "--json"])).toBe(0)
    const answer = v.parse(listEnvelopeSchema(v.unknown()), JSON.parse(out))
    expect(answer.page).toEqual({ mode: "page", limit: answer.items.length, has_more: false })
    expect(answer.meta).toMatchObject({ complete: true })
    expect(answer.items[1]).toEqual({
      name: "beta",
      installed: true,
      path: join(bin, "wcat-beta"),
      version: "2.1.0",
      description: "the beta tool",
    })
  })

  it("prints its version and who runs it, then the list", async () => {
    expect(await wcat(["--version"])).toBe(0)
    expect(out).toMatch(/^wcat \d+\.\d+\.\d+ \(@wirecat\/cli-base, run by wcat-alpha 1\.0\.0\)\n/)
    expect(out).toContain("Installed:")
  })

  it("runs a tool with the rest of the words and answers its exit code", async () => {
    expect(await wcat(["beta", "one", "--json"])).toBe(3)
    expect(err).toBe("")
  })

  it("warns at a terminal when a later program has the same name, and runs the first", async () => {
    tool(other, "wcat-beta", "exit 9")
    expect(await wcat(["beta"])).toBe(3)
    expect(err).toContain("2 programs are named wcat-beta; wcat runs the first:")
  })

  it("refuses an unknown tool, a reserved name and an option before the tool", async () => {
    expect(await wcat(["Nope!"])).toBe(6)
    expect(err).toContain("✗ no wcat-Nope! on PATH; installed: alpha, beta, gamma")
    err = ""
    tool(other, "wcat-update", "echo third-party")
    expect(await wcat(["update", "--json"])).toBe(2)
    expect(JSON.parse(err)).toMatchObject({ error: { code: "validation_error", reason: "input.invalid" } })
    expect(out).toBe("")
    expect(await wcat(["--verbose", "beta"])).toBe(2)
    tool(other, "wcat-app", "exit 0")
    expect(await wcat(["app"])).toBe(2)
  })

  it("lists, adds and removes shortcuts, and refuses another action", async () => {
    tool(other, "gamma", "echo someone else's gamma")
    expect(await wcat(["shortcuts"])).toBe(0)
    expect(out).toMatch(/^ {2}alpha +free: wcat shortcuts add makes it$/m)
    expect(out).toMatch(new RegExp(`^ {2}gamma +taken by ${join(other, "gamma")}$`, "m"))

    out = ""
    expect(await wcat(["shortcuts", "add", "alpha"])).toBe(0)
    expect(out).toBe(`  alpha  made: ${join(bin, "alpha")}\n`)
    expect(parseShim(readFileSync(join(bin, "alpha"), "utf8"))).toEqual({
      format: 1,
      kind: "shortcut",
      target: "wcat-alpha",
    })

    out = ""
    expect(await wcat(["shortcuts", "remove", "alpha", "gamma"])).toBe(0)
    expect(out).toMatch(/^ {2}alpha +removed$/m)
    expect(readFileSync(join(other, "gamma"), "utf8")).toContain("someone else's gamma")

    out = ""
    expect(await wcat(["shortcuts", "list", "alpha", "--json"])).toBe(0)
    expect(v.parse(listEnvelopeSchema(v.unknown()), JSON.parse(out)).items).toEqual([
      { name: "alpha", status: "free", program: join(bin, "wcat-alpha") },
    ])

    // root writes to a read-only folder anyway
    if (process.getuid?.() !== 0) {
      chmodSync(bin, 0o555)
      err = ""
      expect(await wcat(["shortcuts", "add", "alpha"])).toBe(5)
      expect(err).toContain(`could not change ${join(bin, "alpha")}`)
      chmodSync(bin, 0o755)
    }

    expect(await wcat(["shortcuts", "rename"])).toBe(2)
    expect(await wcat(["shortcuts", "add", "nope"])).toBe(6)
  })
})

describe.skipIf(process.platform === "win32")("wcatStart", () => {
  const meta = { command: "alpha", version: "1.0.0", description: "the alpha tool", docs: "https://wirecat.dev/a" }

  it("answers --wcat-describe and hands dispatch mode to wcat", async () => {
    let printed = ""
    const stdout = { write: (text: string) => (printed += text) }
    expect(await wcatStart(meta, { argv: ["node", "wcat-alpha", "--wcat-describe"], stdout })).toEqual({ code: 0 })
    expect(JSON.parse(printed)).toEqual({
      wcat_describe: 1,
      name: "alpha",
      version: "1.0.0",
      description: "the alpha tool",
      docs_url: "https://wirecat.dev/a",
    })

    printed = ""
    const dispatched = await wcatStart(meta, {
      argv: ["node", "wcat-alpha", "--wcat-dispatch", "--json"],
      env: { PATH: "/nonexistent" },
      platform: "linux",
      stdout,
    })
    expect(dispatched).toEqual({ code: 0 })
    expect(JSON.parse(printed).items.map((item: { name: string }) => item.name)).toContain("tg")
  })

  it("writes the launcher into the bin folder of an npm install, and only there", async () => {
    const prefix = mkdtempSync(join(tmpdir(), "wcat-start-"))
    const pkg = join(prefix, "lib/node_modules/@wirecat/alpha-cli")
    mkdirSync(join(prefix, "bin"))
    mkdirSync(join(pkg, "dist"), { recursive: true })
    writeFileSync(join(pkg, "dist/bin.js"), "", { mode: 0o755 })
    symlinkSync(join(pkg, "dist/bin.js"), join(prefix, "bin/wcat-alpha"))
    const io = {
      argv: ["node", join(prefix, "bin/wcat-alpha"), "chats", "list"],
      env: {},
      platform: "linux" as const,
      script: join(pkg, "node_modules/@wirecat/cli-base/dist/wcat/start.js"),
    }
    expect(await wcatStart(meta, io)).toEqual({ launcher: "written" })
    expect(await wcatStart(meta, io)).toEqual({ launcher: "kept" })
    expect(await wcatStart(meta, { ...io, script: join(prefix, "checkout/dist/wcat/start.js") })).toEqual({})
  })
})
