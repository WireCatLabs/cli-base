import { type SpawnSyncReturns, spawn, spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { beforeAll, describe, expect, it } from "vitest"
import { parseShim } from "./shim.js"

const START = fileURLToPath(new URL("./start.ts", import.meta.url))

let root: string
let prefix: string
let bin: string
let other: string
let runtime: string

/** A tool built on cli-base, installed the way npm does on Linux: the package in lib/node_modules, a link in bin. */
const install = async (name: string) => {
  const pkg = join(prefix, "lib", "node_modules", "@wirecat", `${name}-cli`)
  const entry = join(pkg, "src.ts")
  const out = join(pkg, "dist", "bin.js")
  mkdirSync(pkg, { recursive: true })
  writeFileSync(
    entry,
    `import { wcatStart } from ${JSON.stringify(START)}
const { code } = await wcatStart({ command: ${JSON.stringify(name)}, version: "1.0.0", description: "the ${name} tool" })
if (code !== undefined) process.exitCode = code
else {
  const [verb, value] = process.argv.slice(2)
  if (verb === "exit") process.exitCode = Number(value)
  else if (verb === "wait") {
    process.on("SIGTERM", () => { process.stdout.write("${name} got SIGTERM\\n"); process.exit(7) })
    process.stdout.write("waiting\\n")
    setInterval(() => {}, 1000)
  } else process.stdout.write(${JSON.stringify(name)} + " " + process.argv.slice(2).join(" ") + "\\n")
}
`,
  )
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    banner: {
      js: '#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  })
  chmodSync(out, 0o755)
  symlinkSync(out, join(bin, `wcat-${name}`))
}

const script = (dir: string, name: string, body: string) => {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return path
}

// PATH holds only folders the test owns: node's own folder can be the owner's npm global bin, where a real wcat-*
// would be listed, and `shortcuts add` would act on it.
const env = (dirs: string[] = [bin, other]) => ({
  PATH: [...dirs, runtime].join(delimiter),
  HOME: root,
})

const run = (command: string, args: string[] = [], dirs?: string[]): SpawnSyncReturns<string> =>
  spawnSync(command, args, { env: env(dirs), encoding: "utf8", timeout: 20_000 })

const launcher = () => join(bin, "wcat")

describe.skipIf(process.platform === "win32")("wcat, installed like npm installs a tool", () => {
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "wcat-"))
    prefix = join(root, "prefix")
    bin = join(prefix, "bin")
    other = join(root, "other")
    mkdirSync(bin, { recursive: true })
    mkdirSync(other)
    runtime = join(root, "runtime")
    mkdirSync(runtime)
    symlinkSync(process.execPath, join(runtime, "node"))
    await install("alpha")
    await install("beta")
  }, 30_000)

  it("writes the launcher on the tool's first run, and wcat <tool> then runs the tool", () => {
    expect(existsSync(launcher())).toBe(false)
    expect(run(join(bin, "wcat-alpha"), ["hello"]).stdout).toBe("alpha hello\n")
    expect(parseShim(readFileSync(launcher(), "utf8"))).toEqual({ format: 1, kind: "launcher", target: "wcat-alpha" })

    const through = run(join(bin, "wcat"), ["beta", "one", "two words"])
    expect(through.stdout).toBe("beta one two words\n")
    expect(run(join(bin, "wcat"), ["beta", "exit", "42"]).status).toBe(42)
  })

  it("lists every wcat-<name> program with its description, and tolerates one that does not answer", () => {
    script(other, "wcat-gamma", 'echo "not json"')
    script(other, "wcat-help", 'echo "never listed"')
    const listed = run(join(bin, "wcat"), ["--json"])
    expect(listed.status).toBe(0)
    const { items } = JSON.parse(listed.stdout) as { items: Record<string, unknown>[] }
    const byName = new Map(items.map((item) => [item.name, item]))
    expect(byName.get("alpha")).toMatchObject({ installed: true, version: "1.0.0", description: "the alpha tool" })
    expect(byName.get("beta")).toMatchObject({ installed: true, version: "1.0.0", description: "the beta tool" })
    expect(byName.get("gamma")).toEqual({ name: "gamma", installed: true, path: join(other, "wcat-gamma") })
    expect(byName.has("help")).toBe(false)
    expect(byName.get("tg")).toMatchObject({ installed: false, install: "npm install -g @wirecat/tg-cli" })

    const text = run(join(bin, "wcat"), [])
    expect(text.stdout).toMatch(/^ {2}alpha +1\.0\.0 +the alpha tool$/m)
    expect(text.stdout).toMatch(/^ {2}gamma +\(no description\)$/m)
    rmSync(join(other, "wcat-gamma"))
    rmSync(join(other, "wcat-help"))
  })

  it("passes SIGTERM on to the tool and exits with the tool's code", async () => {
    const child = spawn(join(bin, "wcat"), ["alpha", "wait"], { env: env(), stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString()
      if (out.includes("waiting")) child.kill("SIGTERM")
    })
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve))
    expect(out).toContain("alpha got SIGTERM")
    expect(code).toBe(7)
  })

  it("never touches a wcat file it did not write", () => {
    const original = launcher()
    const saved = readFileSync(original, "utf8")
    writeFileSync(original, "#!/bin/sh\necho someone else's wcat\n", { mode: 0o755 })
    run(join(bin, "wcat-alpha"), ["hello"])
    expect(readFileSync(original, "utf8")).toBe("#!/bin/sh\necho someone else's wcat\n")
    writeFileSync(original, saved, { mode: 0o755 })
  })

  it("repairs the launcher from another tool once the tool it started is uninstalled", () => {
    const link = join(bin, "wcat-alpha")
    rmSync(link)
    expect(run(join(bin, "wcat"), ["beta"]).status).not.toBe(0)
    run(join(bin, "wcat-beta"), ["hello"])
    expect(parseShim(readFileSync(launcher(), "utf8"))?.target).toBe("wcat-beta")
    expect(run(join(bin, "wcat"), ["beta", "back"]).stdout).toBe("beta back\n")
    symlinkSync(join(prefix, "lib", "node_modules", "@wirecat", "alpha-cli", "dist", "bin.js"), link)
    run(join(bin, "wcat-alpha"), ["hello"])
    expect(parseShim(readFileSync(launcher(), "utf8"))?.target).toBe("wcat-beta")
  })

  it("makes a shortcut only where the name is free, and removes only its own", () => {
    const taken = script(other, "beta", 'echo "another beta"')
    const status = () =>
      Object.fromEntries(
        (
          JSON.parse(run(join(bin, "wcat"), ["shortcuts", "list", "alpha", "beta", "--json"]).stdout) as {
            items: { name: string }[]
          }
        ).items.map((item) => [item.name, item]),
      )
    expect(status()).toMatchObject({ alpha: { status: "free" }, beta: { status: "taken", path: taken } })

    const added = run(join(bin, "wcat"), ["shortcuts", "add", "alpha", "beta", "--json"])
    expect(added.status).toBe(0)
    expect(JSON.parse(added.stdout).items).toMatchObject([
      { name: "alpha", status: "made", changed: true },
      { name: "beta", status: "taken", changed: false },
    ])
    expect(run(join(bin, "alpha"), ["via", "shortcut"]).stdout).toBe("alpha via shortcut\n")
    expect(run(join(bin, "wcat"), ["shortcuts"]).stdout).toMatch(/^ {2}beta +taken by /m)

    run(join(bin, "wcat"), ["shortcuts", "remove", "alpha", "beta"])
    expect(existsSync(join(bin, "alpha"))).toBe(false)
    expect(readFileSync(taken, "utf8")).toContain("another beta")
    expect(status()).toMatchObject({ alpha: { status: "free" } })
    rmSync(taken)
  })

  it("calls a short name the package installs itself neither free nor removable", () => {
    const own = join(bin, "alpha")
    symlinkSync(join(prefix, "lib", "node_modules", "@wirecat", "alpha-cli", "dist", "bin.js"), own)
    const listed = JSON.parse(run(join(bin, "wcat"), ["shortcuts", "remove", "alpha", "--json"]).stdout)
    expect(listed.items).toMatchObject([{ name: "alpha", status: "package", changed: false }])
    expect(existsSync(own)).toBe(true)
    rmSync(own)
  })

  it("answers --wcat-describe with the tool's metadata", () => {
    const described = run(join(bin, "wcat-alpha"), ["--wcat-describe"])
    expect(JSON.parse(described.stdout)).toEqual({
      wcat_describe: 1,
      name: "alpha",
      version: "1.0.0",
      description: "the alpha tool",
    })
  })
})
