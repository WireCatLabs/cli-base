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
import { parseLucene } from "../query/parser.js"
import type { Effects } from "../standards/effects.js"
import { describeAnswer, parseDescribe } from "./describe.js"
import {
  buildManifest,
  type ManifestIdentity,
  manifestJsonSchema,
  manifestSchema,
  PLAIN_WORD,
  SHARED_HOSTS,
} from "./manifest.js"
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
  root.addCommand(leaf("sync", { remote: "read", local: "write" }))
  root.addCommand(new Command("session").addCommand(leaf("list", READ)).addCommand(leaf("start")))
  root.addCommand(new Command("contacts").addCommand(leaf("list", { remote: "read", local: "write" })))
  root.addCommand(new Command("runs").addCommand(leaf("list", READ)).addCommand(leaf("show", READ)))
  root.addCommand(
    new Command("skill").addCommand(leaf("status", READ)).addCommand(leaf("install")).addCommand(leaf("show", READ)),
  )
  const server = new Command("server")
    .addCommand(leaf("start").option("--port <port>", "the local port").option("--public-url <url>", "the URL"))
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
  syncs: "contacts and deals",
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
    expect(manifest).not.toHaveProperty("version")
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
        start: ["mcp", "server", "start", "--port", "{port}", "--public-url", "{url}", "--json"],
        stop: ["mcp", "server", "stop", "--json"],
        status: ["mcp", "server", "status", "--no-record", "--json"],
        revoke: ["mcp", "revoke", "--json"],
        config: null,
      },
      tasks: null,
      sync: {
        run: ["{profile}", "sync", "--record", "--json"],
        last: ["runs", "list", "command:sync", "status:success", "--limit", "50", "--no-record", "--json"],
        lastShape: "runs",
        what: "contacts and deals",
        note: null,
      },
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
    expect([desktop.runs, desktop.skill, desktop.mcpServer, desktop.signIn, desktop.sync]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ])
  })

  it("runs a single <noun> sync and finds its last run by the quoted phrase, as Desktop's catalog does", () => {
    const tree = new Command("acme")
      .addCommand(new Command("doctor").action(() => {}))
      .addCommand(new Command("runs").addCommand(new Command("list").action(() => {})))
      .addCommand(new Command("contacts").addCommand(new Command("sync").action(() => {})))
    expect(build({}, describeProgram(tree)).desktop.sync).toEqual({
      run: ["contacts", "sync", "--record", "--json"],
      last: ["runs", "list", 'command:"contacts sync" status:success', "--limit", "50", "--no-record", "--json"],
      lastShape: "runs",
      what: "contacts and deals",
      note: null,
    })
  })

  it("names how a saved call opens only when the identity names its provider, so older Desktops still read it", () => {
    const tree = program().addCommand(
      new Command("meetings")
        .addCommand(new Command("show").argument("<id>").action(() => {}))
        .addCommand(new Command("transcript").argument("<id>").action(() => {})),
    )
    expect(build({}, describeProgram(tree)).desktop).not.toHaveProperty("meetings")
    expect(build({ meetingsProvider: "acme" }, describeProgram(tree)).desktop.meetings).toEqual({
      provider: "acme",
      show: ["{profile}", "meetings", "show", "{id}", "--no-record", "--json"],
      transcript: ["{profile}", "meetings", "transcript", "{id}", "--no-record", "--json"],
    })
    expect(() => build({ meetingsProvider: "acme" })).toThrow("meetingsProvider needs `meetings show`")
    expect(() => build({ meetingsProvider: "Acme PBX" }, describeProgram(tree))).toThrow("a provider name")
  })

  it("removes an account with session end and account remove, and leaves the key out for a CLI with neither", () => {
    const withAccounts = (account: Command) => {
      const root = program().addCommand(account)
      root.commands.find((command) => command.name() === "session")?.addCommand(new Command("end").action(() => {}))
      return describeProgram(root)
    }
    const remove = new Command("remove").action(() => {})
    for (const flag of ["--keep-data", "--delete-data", "--dry-run"]) remove.option(flag, flag)
    const full = new Command("account").addCommand(new Command("list").action(() => {})).addCommand(remove)
    expect(build({}, withAccounts(full)).desktop.accountRemove).toEqual({
      signOut: ["{profile}", "session", "end", "--record", "--json"],
      remove: {
        minVersion: "0.0.0",
        keepData: ["{profile}", "account", "remove", "--keep-data", "--record", "--json"],
        deleteData: ["{profile}", "account", "remove", "--delete-data", "--record", "--json"],
        dryRun: "--dry-run",
        confirm: "--yes",
      },
      removes: ["signIn"],
      keeps: ["settings", "data", "listed"],
    })

    const listOnly = new Command("account").addCommand(new Command("list").action(() => {}))
    expect(build({}, withAccounts(listOnly)).desktop.accountRemove).toEqual({
      signOut: ["{profile}", "session", "end", "--record", "--json"],
      remove: null,
      removes: ["signIn"],
      keeps: ["settings", "data", "listed"],
    })

    const removeOnly = program().addCommand(full)
    expect(build({}, describeProgram(removeOnly)).desktop.accountRemove).toMatchObject({
      signOut: null,
      removes: [],
      keeps: [],
    })

    expect(build().desktop).not.toHaveProperty("accountRemove")
  })

  it("passes the sign-ins Desktop runs in its window, only when declared and only for a command the CLI has", () => {
    const token = { id: "token", label: "API token", words: ["{profile}", "session", "start", "--json"], stdin: true }
    const signIn = { ...identity.signIn, methods: [token] } as ManifestIdentity["signIn"]
    expect(build().desktop.signIn).not.toHaveProperty("methods")
    expect(build({ signIn }).desktop.signIn?.methods).toEqual([token])
    const as = (words: string[]) =>
      ({ ...identity.signIn, methods: [{ ...token, words }] }) as ManifestIdentity["signIn"]
    expect(() => build({ signIn: as(["session", "start"]) })).toThrow("start with {profile}")
    expect(() => build({ signIn: as(["{profile}", "session"]) })).toThrow("`session` names no command")
    expect(() => build({ signIn: as(["{profile}", "session", "start", "{port}"]) })).toThrow("the only slot")
    expect(() => build({ signIn: as(["{profile}", "session", "start", "$(id)"]) })).toThrow("is not a plain word")
    expect(() =>
      build({ signIn: { ...identity.signIn, methods: [{ ...token, password: "ACME_TOKEN" }] } as never }),
    ).toThrow(/password/)
  })

  it("passes an application password sign-in's site and login flags, only when its command takes both", () => {
    const appPassword = {
      id: "app-password",
      label: "Acme application password",
      words: ["{profile}", "session", "start", "--json"],
      stdin: true,
      site: "--site",
      login: "--login",
    } as const
    const signIn = (method: object) => ({ ...identity.signIn, methods: [method] }) as ManifestIdentity["signIn"]
    const tree = program()
    const start = tree.commands
      .find((command) => command.name() === "session")
      ?.commands.find((c) => c.name() === "start")
    start
      ?.option("--site <address>", "the site")
      .option("--login <user>", "the user name")
      .option("--url <url>", "a URL")
    const commands = describeProgram(tree)

    expect(build({ signIn: signIn(appPassword) }, commands).desktop.signIn?.methods).toEqual([appPassword])
    expect(() => build({ signIn: signIn(appPassword) })).toThrow("`session start` takes no --site or --login")
    expect(() => build({ signIn: signIn({ ...appPassword, login: undefined }) }, commands)).toThrow("go together")
    expect(() => build({ signIn: signIn({ ...appPassword, stdin: false }) }, commands)).toThrow("password on stdin")
    expect(() => build({ signIn: signIn({ ...appPassword, site: "--url" }) }, commands)).toThrow('Expected "--site"')
  })

  it("names setupFrom when the CLI has cli-core's setup flow commands, so Desktop asks for the flow", () => {
    const flow = (names: string[]) => {
      const tree = program()
      const setup = new Command("setup").action(() => {})
      for (const name of names) setup.addCommand(new Command(name).action(() => {}))
      return describeProgram(tree.addCommand(setup))
    }

    expect(build({}, flow(["show", "apply", "run"])).desktop.signIn).toEqual({
      ...identity.signIn,
      setupFrom: "0.0.0",
    })
    expect(build({}, flow(["show", "apply"])).desktop.signIn).not.toHaveProperty("setupFrom")
    expect(build().desktop.signIn).not.toHaveProperty("setupFrom")
    expect(build({ signIn: undefined }, flow(["show", "apply", "run"])).desktop.signIn).toBeNull()
  })

  it("matches runs list's query: command:sync status:success are two exact terms", () => {
    const ast = parseLucene(["command:sync", "status:success"].join(" "), { defaultField: "none" })
    expect(JSON.stringify(ast)).toMatch(/"field":"command","operator":"term","value":"sync"/)
    expect(JSON.stringify(ast)).toMatch(/"field":"status","operator":"term","value":"success"/)
  })

  it("matches runs list's query: a quoted command is one phrase, so it equals the recorded `contacts sync`", () => {
    const ast = JSON.stringify(parseLucene('command:"contacts sync" status:success', { defaultField: "none" }))
    expect(ast).toMatch(/"field":"command","operator":"phrase","value":"contacts sync"/)
    expect(ast).toMatch(/"field":"status","operator":"term","value":"success"/)
  })

  it("takes the quoted sync query in sync.last only, and no other quoted word", () => {
    const manifest = build()
    const query = 'command:"contacts sync" status:success'
    const at = (desktop: object) => v.safeParse(manifestSchema, { ...manifest, desktop }).success
    const sync = manifest.desktop.sync as NonNullable<typeof manifest.desktop.sync>
    expect(at({ ...manifest.desktop, sync: { ...sync, last: ["runs", "list", query] } })).toBe(true)
    expect(at({ ...manifest.desktop, sync: { ...sync, run: ["runs", "list", query] } })).toBe(false)
    expect(at({ ...manifest.desktop, doctor: [query] })).toBe(false)
    for (const word of [
      'command:"contacts sync"; rm -rf ~',
      'command:"$(id) x" status:success',
      'command:"sync" status:success',
    ])
      expect(at({ ...manifest.desktop, sync: { ...sync, last: ["runs", "list", word] } })).toBe(false)
  })

  it("refuses a CLI without doctor, a tagline or its wcat- bin, saying what to add", () => {
    expect(() => build({}, [])).toThrow("no doctor command")
    expect(() => build({ tagline: undefined })).toThrow("no tagline")
    expect(() => build({ syncs: undefined })).toThrow("no syncs: `sync` exists")
    expect(() =>
      buildManifest({ identity, commands: describeProgram(program()), pkg: { ...pkg, bin: {} }, skills: true }),
    ).toThrow('"bin" installs neither wcat-acme nor acme')
  })

  it("refuses to emit a word Desktop would refuse, and names it", () => {
    const odd = program()
    odd.addCommand(new Command("rm;id").action(() => {}))
    expect(() => build({}, describeProgram(odd))).toThrow(/commands\.\d+\.path\.0: "rm;id" is not a plain word/)
  })

  it("says what each command touches in words: its summary, its entity and the entity's known fields", () => {
    const tree = program()
    const field = (name: string, relation?: string) => ({
      name,
      type: "kw" as const,
      operators: ["term" as const],
      example: `${name}:x`,
      ...(relation ? { relation } : {}),
    })
    const people = new Command("people")
    people.addCommand(
      annotate(
        new Command("list").summary("list people").action(() => {}),
        {
          effects: READ,
          output: { entity: "person" },
          query: {
            entity: "person",
            backend: "sql",
            fields: [field("name"), field("email"), field("deals", "their deals")],
          },
        },
      ),
    )
    people.addCommand(
      annotate(
        new Command("show").description("show one person\nwith every detail").action(() => {}),
        {
          effects: READ,
          output: { entity: "person" },
        },
      ),
    )
    tree.addCommand(people)
    const manifest = build({}, describeProgram(tree))
    expect(manifest.commands.filter((command) => command.path[0] === "people")).toEqual([
      { path: ["people", "list"], summary: "list people", effects: READ, entity: "person" },
      { path: ["people", "show"], summary: "show one person", effects: READ, entity: "person" },
    ])
    expect(manifest.entities).toEqual({ person: { fields: ["name", "email"] } })
  })

  it("writes the declared hosts and the shared packages' own, and leaves network out when the CLI did not say", () => {
    expect(build().network).toBeUndefined()
    expect(build({ hosts: [] }).network).toEqual({ hosts: SHARED_HOSTS })
    expect(build({ hosts: ["registry.npmjs.org"] }).network).toEqual({ hosts: SHARED_HOSTS })
    expect(
      build({ hosts: ["api.acme.example", "*.cdn.acme.example"], userHosts: "the mail server you sign in to" }),
    ).toMatchObject({
      network: {
        hosts: ["api.acme.example", "*.cdn.acme.example", ...SHARED_HOSTS],
        user_hosts: "the mail server you sign in to",
      },
    })
    expect(() => build({ hosts: ["https://api.acme.example"] })).toThrow(/network\.hosts\.0: .* is not a host/)
    expect(() => build({ hosts: ["*.com"] })).toThrow(/is not a host/)
    expect(() => build({ hosts: ["api.acme.example", "api.acme.example"] })).toThrow("listed twice")
    expect(() => build({ userHosts: "the mail server you sign in to" })).toThrow("userHosts needs hosts")
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
