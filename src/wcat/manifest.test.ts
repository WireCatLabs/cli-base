import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { Command } from "commander"
import * as v from "valibot"
import { beforeEach, describe, expect, it } from "vitest"
import { annotate, describeProgram } from "../commands/registry.js"
import { type DevIo, main } from "../dev/main.js"
import type { Effects } from "../standards/effects.js"
import { describeAnswer, parseDescribe } from "./describe.js"
import { buildManifest, type ManifestIdentity, manifestJsonSchema, manifestSchema, PLAIN_WORD } from "./manifest.js"
import { DESCRIBE_MAX_BYTES } from "./names.js"
import { wcatStart } from "./start.js"

const READ = { remote: "none", local: "read" } as const

const program = () => {
  const root = new Command("acme")
  const leaf = (name: string, effects?: Effects) => {
    const command = new Command(name).action(() => {})
    return effects ? annotate(command, { effects }) : command
  }
  root.addCommand(leaf("doctor", READ))
  root.addCommand(new Command("session").addCommand(leaf("list", READ)).addCommand(leaf("start")))
  root.addCommand(new Command("contacts").addCommand(leaf("list", { remote: "read", local: "write" })))
  root.addCommand(new Command("runs").addCommand(leaf("list", READ)).addCommand(leaf("show", READ)))
  root.addCommand(
    new Command("skill").addCommand(leaf("status", READ)).addCommand(leaf("install")).addCommand(leaf("show", READ)),
  )
  const server = new Command("server")
    .addCommand(
      leaf("start").option("--port <port>", "the local port (default 8790)").option("--public-url <url>", "the URL"),
    )
    .addCommand(leaf("stop"))
    .addCommand(leaf("status", READ))
  root.addCommand(new Command("mcp").addCommand(server).addCommand(leaf("revoke")))
  return root
}

const identity: ManifestIdentity = {
  command: "acme",
  version: "0.3.0",
  description: "Acme CRM contacts and deals for your agent",
  docs: "https://example.com/acme",
  appName: "acme-cli",
  envPrefix: "ACME",
  tagline: "Acme contacts, searchable on your computer",
  signIn: { gives: "Lets your agent read your Acme contacts.", asks: "An Acme API token." },
  permissionOf: (path) => (path[0] === "contacts" ? path.join(".") : null),
}

const pkg = { name: "@example/acme-cli", bin: { "wcat-acme": "dist/bin/acme.js" } }
const build = (overrides: Partial<ManifestIdentity> = {}, commands = describeProgram(program())) =>
  buildManifest({ identity: { ...identity, ...overrides }, commands, pkg, skills: true })

describe("buildManifest", () => {
  it("derives the commands and Desktop's words from the command tree", () => {
    const manifest = build()
    expect(manifest).toMatchObject({
      wcat_manifest: 2,
      name: "acme",
      version: "0.3.0",
      docs_url: "https://example.com/acme",
      package: "@example/acme-cli",
      bin: "wcat-acme",
    })
    expect(manifest.commands).toContainEqual({
      path: ["contacts", "list"],
      effects: { remote: "read", local: "write" },
      permission: "contacts.list",
    })
    expect(manifest.commands).toContainEqual({
      path: ["session", "start"],
      effects: { remote: "write", local: "write" },
    })
    expect(manifest.commands.map((command) => command.path.join(" "))).not.toContain("session")
    expect(manifest.desktop).toEqual({
      tagline: "Acme contacts, searchable on your computer",
      profiles: { args: ["session", "list", "--no-record", "--json"], shape: "items" },
      doctor: ["{profile}", "doctor", "--record", "--json"],
      runs: {
        list: ["runs", "list", "{query}", "--limit", "{limit}", "--page", "{page}", "--no-record", "--json"],
        show: ["runs", "show", "{run}", "--no-record", "--json"],
      },
      search: null,
      setup: ["{profile}", "session", "start"],
      signIn: { gives: "Lets your agent read your Acme contacts.", asks: "An Acme API token." },
      skill: {
        status: ["skill", "status", "--no-record", "--json"],
        install: ["skill", "install", "--for", "{target}", "--json"],
        show: ["skill", "show", "--no-record", "--json"],
      },
      mcpServer: {
        port: 8790,
        start: ["mcp", "server", "start", "--port", "{port}", "--public-url", "{url}", "--json"],
        stop: ["mcp", "server", "stop", "--json"],
        status: ["mcp", "server", "status", "--no-record", "--json"],
        revoke: ["mcp", "revoke", "--json"],
        config: null,
      },
      tasks: null,
      sync: null,
      storeInfo: null,
      storeTables: null,
      storeTableSizes: null,
      storeCheck: null,
      storeBackup: null,
      storeBackupEncrypted: null,
      storeResetPreview: null,
      storeReset: null,
      storage: { app: "acme-cli", env: "ACME" },
      settings: null,
    })
  })

  it("leaves {profile} out and the key null when the CLI has no such command", () => {
    const bare = new Command("acme").addCommand(new Command("doctor").action(() => {}))
    const { desktop } = buildManifest({
      identity: { ...identity, signIn: undefined },
      commands: describeProgram(bare),
      pkg,
      skills: false,
    })
    expect(desktop).toMatchObject({ profiles: null, doctor: ["doctor", "--record", "--json"], setup: null })
    expect([desktop.runs, desktop.skill, desktop.mcpServer, desktop.signIn]).toEqual([null, null, null, null])
  })

  it("refuses a CLI without doctor, a tagline or its wcat- bin, saying what to add", () => {
    expect(() => build({}, [])).toThrow("no doctor command")
    expect(() => build({ tagline: undefined })).toThrow("no tagline")
    expect(() =>
      buildManifest({ identity, commands: describeProgram(program()), pkg: { ...pkg, bin: {} }, skills: true }),
    ).toThrow('"bin" installs neither wcat-acme nor acme')
  })

  it("refuses to emit a word Desktop would refuse, and names it", () => {
    const odd = program()
    odd.addCommand(new Command("rm;id").action(() => {}))
    expect(() => build({}, describeProgram(odd))).toThrow(/commands\.\d+\.path\.0: "rm;id" is not a plain word/)
  })
})

describe("the plain-word rule", () => {
  it("agrees with Desktop's community.rs cases", () => {
    for (const word of ["--no-record", "--", "{profile}", "email:{profile}", "--limit={limit}", "a@b/c", "a.b,c+d"])
      expect(word).toMatch(PLAIN_WORD)
    for (const word of [
      "setup;rm",
      "a b",
      "$(id)",
      "`id`",
      "a|b",
      "a&b",
      "~/x",
      "*",
      "x\ny",
      "'x'",
      '"x"',
      "-",
      "---x",
      "{pro file}",
      "{profile",
      "a}b",
    ])
      expect(word).not.toMatch(PLAIN_WORD)
  })

  it("holds for every array at any depth, through the exported schema", () => {
    const manifest = build()
    const bad = { ...manifest, desktop: { ...manifest.desktop, runs: { list: ["runs", "a b"], show: ["x"] } } }
    expect(v.safeParse(manifestSchema, manifest).success).toBe(true)
    expect(v.safeParse(manifestSchema, bad).success).toBe(false)
    expect(JSON.stringify(manifestJsonSchema())).toContain(JSON.stringify(PLAIN_WORD.source))
  })
})

describe("cli-dev manifest", () => {
  let root: string
  let out: string[]
  let err: string[]
  let io: DevIo

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cli-dev-manifest-"))
    out = []
    err = []
    io = { cwd: root, out: (text) => out.push(text), err: (text) => err.push(text) }
    const registry = JSON.stringify(new URL("../commands/registry.ts", import.meta.url).href)
    const commander = JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve("commander")).href)
    writeFileSync(join(root, "package.json"), JSON.stringify(pkg))
    writeFileSync(
      join(root, "program.ts"),
      `import { Command } from ${commander}
import { annotate } from ${registry}
export const createProgram = () =>
  new Command("acme").addCommand(annotate(new Command("doctor").action(() => {}), { effects: { remote: "none", local: "read" } }))
`,
    )
    writeFileSync(
      join(root, "identity.ts"),
      `export const WCAT = ${JSON.stringify({ ...identity, permissionOf: undefined })}\n`,
    )
  })

  const args = ["manifest", "--program", "program.ts", "--identity", "identity.ts"]

  it("writes contracts/wirecat.json, and --check fails once it is stale with the command that fixes it", async () => {
    expect(await main([...args, "--check"], io)).toBe(1)
    expect(err).toEqual([
      `contracts/wirecat.json is missing: run cli-dev manifest --program program.ts --identity identity.ts`,
    ])
    expect(await main(args, io)).toBe(0)
    const written = JSON.parse(readFileSync(join(root, "contracts/wirecat.json"), "utf8"))
    expect(written.commands).toEqual([{ path: ["doctor"], effects: READ }])
    expect(await main([...args, "--check"], io)).toBe(0)

    writeFileSync(join(root, "package.json"), JSON.stringify({ ...pkg, name: "@example/acme-crm" }))
    err.length = 0
    expect(await main([...args, "--check"], io)).toBe(1)
    expect(err[0]).toMatch(/is stale: run cli-dev manifest/)
  })
})

describe("--wcat-describe", () => {
  const start = async (dir: string) => {
    let printed = ""
    const stdout = { write: (text: string) => (printed += text) }
    const bin = join(dir, "dist", "bin", "acme.js")
    mkdirSync(join(dir, "dist", "bin"), { recursive: true })
    writeFileSync(bin, "")
    expect(await wcatStart(identity, { argv: ["node", bin, "--wcat-describe"], stdout })).toEqual({ code: 0 })
    return printed
  }

  it("answers format 1 exactly as before when the package ships no manifest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wcat-describe-"))
    writeFileSync(join(dir, "package.json"), "{}")
    const printed = await start(dir)
    expect(JSON.parse(printed)).toEqual({
      wcat_describe: 1,
      name: "acme",
      version: "0.3.0",
      description: identity.description,
      docs_url: "https://example.com/acme",
    })
    expect(parseDescribe(printed)).toEqual({
      version: "0.3.0",
      description: identity.description,
      docs: "https://example.com/acme",
    })
  })

  it("answers format 2 with the shipped file's desktop object and the hash of its bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wcat-describe-"))
    writeFileSync(join(dir, "package.json"), "{}")
    mkdirSync(join(dir, "contracts"))
    const text = `${JSON.stringify(build(), null, 2)}\n`
    writeFileSync(join(dir, "contracts", "wirecat.json"), text)
    const sha = createHash("sha256").update(text).digest("hex")

    const printed = await start(dir)
    const answer = JSON.parse(printed)
    expect(answer).toMatchObject({ wcat_describe: 2, name: "acme", version: "0.3.0", manifest_sha256: sha })
    expect(answer.desktop).toEqual(build().desktop)
    expect(answer.commands).toBeUndefined()
    expect(Buffer.byteLength(printed)).toBeLessThan(DESCRIBE_MAX_BYTES)
    expect(parseDescribe(printed)).toMatchObject({ version: "0.3.0", manifestSha256: sha })
  })

  it("falls back to format 1 rather than pass wcat's 64 KiB cap", () => {
    const huge = { desktop: { note: "x".repeat(DESCRIBE_MAX_BYTES) }, sha256: "0".repeat(64) }
    expect(describeAnswer(identity, huge)).not.toHaveProperty("desktop")
    expect(describeAnswer(identity, huge).wcat_describe).toBe(1)
  })
})
