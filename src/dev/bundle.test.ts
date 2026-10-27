import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { isServer, LOADER_MARK } from "./bundle.js"
import { type DevIo, main } from "./main.js"

let root: string
let out: string[]
let err: string[]
let io: DevIo

const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const json = (value: unknown) => JSON.stringify(value)

const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["dist/bin/demo.js", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cli-dev-bundle-"))
  out = []
  err = []
  io = { cwd: root, out: (text) => out.push(text), err: (text) => err.push(text) }
  write("package.json", json({ name: "demo", version: "1.2.3", type: "module" }))
  write(
    "dist/bin/demo.js",
    `#!/usr/bin/env node
const { run } = await import("../program.js")
await run(process.argv.slice(2))
`,
  )
  write(
    "dist/program.js",
    `import { readFileSync } from "node:fs"
import { skill } from "@wirecat/cli-core"
export const run = async (words) => {
  if (words[0] === "--version") return console.log("1.2.3 from the program")
  const own = readFileSync(new URL("./data.txt", import.meta.url), "utf8").trim()
  const { shout } = await import("shouting")
  console.log(JSON.stringify({ own, core: await skill(), shout: shout("hi") }))
}
`,
  )
  write("dist/data.txt", "own data\n")
  write(
    "node_modules/@wirecat/cli-core/package.json",
    json({ name: "@wirecat/cli-core", type: "module", exports: { ".": { default: "./dist/index.js" } } }),
  )
  write(
    "node_modules/@wirecat/cli-core/dist/index.js",
    `import { readFileSync } from "node:fs"
export const skill = async () => readFileSync(new URL("../skills/SKILL.md", import.meta.url), "utf8").trim()
`,
  )
  write("node_modules/@wirecat/cli-core/skills/SKILL.md", "core skill\n")
  write("node_modules/shouting/package.json", json({ name: "shouting", main: "index.js" }))
  write("node_modules/shouting/index.js", "exports.shout = (text) => text.toUpperCase()\n")
})

describe("bundle", () => {
  it("runs the program from the bundle, its lazy import a chunk, its files found where they were", async () => {
    expect(await main(["bundle", "--bin", "dist/bin/demo.js"], io)).toBe(0)
    expect(readFileSync(join(root, "dist/bin/demo.js"), "utf8")).toContain(LOADER_MARK)
    expect(readFileSync(join(root, "dist/bundle/demo.js"), "utf8")).not.toContain("own data")
    expect(readdirSync(join(root, "dist/bundle")).length).toBeGreaterThan(1)

    renameSync(join(root, "dist/program.js"), join(root, "dist/program.js.gone"))
    const answer = run([])
    expect(answer.stderr).toBe("")
    expect(JSON.parse(answer.stdout)).toEqual({ own: "own data", core: "core skill", shout: "HI" })
  })

  it("answers --version in the loader, and leaves it to the CLI when a test records the argv", async () => {
    await main(["bundle", "--bin", "dist/bin/demo.js"], io)
    expect(run(["--version"]).stdout).toBe("1.2.3\n")
    expect(run(["--version"], { DEMO_TEST_ARGV_LOG: join(root, "argv.jsonl") }).stdout).toBe("1.2.3 from the program\n")
  })

  it("names in the loader only the chunks it built, for a server to preload", async () => {
    await main(["bundle", "--bin", "dist/bin/demo.js"], io)
    const loader = readFileSync(join(root, "dist/bin/demo.js"), "utf8")
    const chunks = [...loader.matchAll(/"\.\.\/bundle\/([^"]+)"/g)].map(([, chunk]) => chunk ?? "")
    expect(chunks.filter((chunk) => chunk !== "demo.js").length).toBeGreaterThan(0)
    expect(chunks.every((chunk) => existsSync(join(root, "dist/bundle", chunk)))).toBe(true)
    expect(out.join("\n")).toMatch(/a server preloads \d+ chunks/)
  })

  it("fails when an anchored package imports an outside package, which would resolve from the bundle", async () => {
    write(
      "node_modules/@wirecat/cli-core/dist/index.js",
      `import Database from "better-sqlite3"
export const skill = async () => String(Database)
`,
    )
    expect(await main(["bundle", "--bin", "dist/bin/demo.js"], io)).toBe(1)
    expect(err.join("\n")).toContain("imports better-sqlite3, which would resolve from the bundle")
    expect(readFileSync(join(root, "dist/bin/demo.js"), "utf8")).not.toContain(LOADER_MARK)
  })

  it("fails on a third-party file that looks itself up, unless it is named harmless", async () => {
    write("node_modules/shouting/index.js", "exports.shout = (text) => __dirname + text\n")
    expect(await main(["bundle", "--bin", "dist/bin/demo.js"], io)).toBe(1)
    expect(err.join("\n")).toContain(join("shouting", "index.js"))
    err.length = 0
    expect(await main(["bundle", "--bin", "dist/bin/demo.js", "--harmless", "/shouting/index.js"], io)).toBe(0)
  })

  it("keeps a package named --external outside, loaded from where the CLI installed it", async () => {
    await main(["bundle", "--bin", "dist/bin/demo.js", "--external", "shout*"], io)
    const bundled = readdirSync(join(root, "dist/bundle"))
      .map((file) => readFileSync(join(root, "dist/bundle", file), "utf8"))
      .join("\n")
    expect(bundled).not.toContain("toUpperCase")
    expect(JSON.parse(run([]).stdout).shout).toBe("HI")
  })

  it("refuses a bin that is already the loader, and asks for --bin", async () => {
    await main(["bundle", "--bin", "dist/bin/demo.js"], io)
    expect(await main(["bundle", "--bin", "dist/bin/demo.js"], io)).toBe(1)
    expect(err.join("\n")).toContain("already the loader")
    expect(await main(["bundle"], io)).toBe(2)
  })

  it("treats serve, watch and mcp serve as servers, also after a flag, and a short command as not one", () => {
    for (const words of [
      ["personal", "mcp", "serve"],
      ["personal", "--read-only", "mcp", "serve"],
      ["personal", "--timeout", "30", "mcp", "serve", "--http"],
      ["mcp", "serve"],
      ["personal", "serve"],
      ["personal", "watch"],
      ["personal", "mcp"],
      ["personal", "mcp", "--http"],
    ])
      expect(isServer(words), words.join(" ")).toBe(true)
    for (const words of [[], ["--version"], ["personal", "mcp", "config"], ["personal", "chats", "list", "--json"]])
      expect(isServer(words), words.join(" ")).toBe(false)
  })

  it("writes the same server check into the loader", async () => {
    await main(["bundle", "--bin", "dist/bin/demo.js"], io)
    expect(readFileSync(join(root, "dist/bin/demo.js"), "utf8")).toContain(isServer.toString())
  })
})
