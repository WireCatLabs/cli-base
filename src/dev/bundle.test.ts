import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { isServer, isUpgrade, LOADER_MARK } from "./bundle.js"
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

  it("loads a static import of an outside package in an anchored package from that package's place", async () => {
    write(
      "node_modules/@wirecat/cli-core/dist/index.js",
      `import { readFileSync } from "node:fs"
import engine, { name as engineName } from "fake-native"
export const skill = async () => readFileSync(new URL("../skills/SKILL.md", import.meta.url), "utf8").trim() + engine + engineName
`,
    )
    write(
      "node_modules/@wirecat/cli-core/node_modules/fake-native/package.json",
      json({ name: "fake-native", type: "module" }),
    )
    write(
      "node_modules/@wirecat/cli-core/node_modules/fake-native/index.js",
      `export default " +"\nexport const name = "engine"\n`,
    )
    expect(await main(["bundle", "--bin", "dist/bin/demo.js", "--external", "fake-native"], io)).toBe(0)
    expect(JSON.parse(run([]).stdout).core).toBe("core skill +engine")
  })

  it("fails when a third-party module imports an outside package, which would resolve from the bundle", async () => {
    write("node_modules/shouting/index.js", `exports.shout = (text) => require("better-sqlite3") && text\n`)
    expect(await main(["bundle", "--bin", "dist/bin/demo.js"], io)).toBe(1)
    expect(err.join("\n")).toContain("imports better-sqlite3, which would resolve from the bundle")
    expect(readFileSync(join(root, "dist/bin/demo.js"), "utf8")).not.toContain(LOADER_MARK)
  })

  it("keeps the bin's #! line first when it rewrites the bin", async () => {
    write(
      "dist/bin/demo.js",
      `#!/usr/bin/env node\nconst { shout } = await import("shouting")\nconsole.log(shout("hi"))\n`,
    )
    expect(await main(["bundle", "--bin", "dist/bin/demo.js", "--external", "shouting"], io)).toBe(0)
    expect(readFileSync(join(root, "dist/bundle/demo.js"), "utf8").startsWith("#!")).toBe(true)
    expect(run([]).stdout).toBe("HI\n")
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

  it("drops the .d.ts and .map files tsc wrote, unless the package has exports someone imports", async () => {
    const declarations = ["dist/program.d.ts", "dist/program.d.ts.map", "dist/program.js.map", "dist/bin/demo.js.map"]
    for (const file of declarations) write(file, "{}\n")
    await main(["bundle", "--bin", "dist/bin/demo.js"], io)
    expect(declarations.filter((file) => existsSync(join(root, file)))).toEqual([])
    expect(existsSync(join(root, "dist/program.js"))).toBe(true)
    expect(existsSync(join(root, "dist/data.txt"))).toBe(true)

    write(
      "package.json",
      json({ name: "demo", version: "1.2.3", type: "module", exports: { ".": "./dist/program.js" } }),
    )
    write("dist/bin/demo.js", `#!/usr/bin/env node\nawait import("../program.js")\n`)
    for (const file of declarations) write(file, "{}\n")
    await main(["bundle", "--bin", "dist/bin/demo.js"], io)
    expect(declarations.filter((file) => existsSync(join(root, file)))).toEqual(declarations)
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

  it("loads every chunk before an upgrade, which replaces the files the process runs from", async () => {
    for (const words of [["upgrade"], ["upgrade", "--check"], ["--json", "upgrade"], ["personal", "upgrade"]])
      expect(isUpgrade(words), words.join(" ")).toBe(true)
    for (const words of [[], ["personal", "chats", "list"], ["personal", "messages", "send", "Ana", "upgrade"]])
      expect(isUpgrade(words), words.join(" ")).toBe(false)
    await main(["bundle", "--bin", "dist/bin/demo.js"], io)
    expect(readFileSync(join(root, "dist/bin/demo.js"), "utf8")).toContain(isUpgrade.toString())
  })

  it("writes the same server check into the loader", async () => {
    await main(["bundle", "--bin", "dist/bin/demo.js"], io)
    expect(readFileSync(join(root, "dist/bin/demo.js"), "utf8")).toContain(isServer.toString())
  })
})

describe("bundle with a pre-bundled cli-core", () => {
  beforeEach(() => {
    write(
      "package.json",
      json({
        name: "demo",
        version: "1.2.3",
        type: "module",
        dependencies: { "@wirecat/cli-core": "3.0.0", "@wirecat/cli-base": "1.2.0", shouting: "1.0.0" },
      }),
    )
    write(
      "dist/program.js",
      `import { marker } from "@wirecat/cli-base"
import { skill, sameBase } from "@wirecat/cli-core"
export const run = async () => {
  const { shout } = await import("shouting")
  console.log(JSON.stringify({ core: await skill(), oneBase: sameBase(marker), shout: shout("hi") }))
}
`,
    )
    write(
      "node_modules/@wirecat/cli-core/package.json",
      json({
        name: "@wirecat/cli-core",
        version: "3.0.0",
        type: "module",
        exports: { ".": { default: "./dist/bundle/index.js" }, "./preload": { default: "./dist/bundle/preload.js" } },
        peerDependencies: { "@wirecat/cli-base": "^1.2.0", commander: "^15.0.0" },
      }),
    )
    write(
      "node_modules/@wirecat/cli-core/dist/bundle/index.js",
      `import { readFileSync } from "node:fs"
import { marker } from "@wirecat/cli-base"
export const sameBase = (other) => other === marker
export const skill = async () => readFileSync(new URL("../../skills/SKILL.md", import.meta.url), "utf8").trim()
`,
    )
    write("node_modules/@wirecat/cli-core/dist/bundle/preload.js", "export const preload = async () => {}\n")
    write(
      "node_modules/@wirecat/cli-base/package.json",
      json({ name: "@wirecat/cli-base", type: "module", exports: { ".": { default: "./dist/bundle/index.js" } } }),
    )
    write("node_modules/@wirecat/cli-base/dist/bundle/index.js", "export const marker = {}\n")
  })

  const bundled = () =>
    readdirSync(join(root, "dist/bundle"))
      .map((file) => readFileSync(join(root, "dist/bundle", file), "utf8"))
      .join("\n")

  it("leaves cli-core, cli-base and cli-core's peers outside, one instance each, and preloads cli-core for a server", async () => {
    expect(await main(["bundle", "--bin", "dist/bin/demo.js"], io)).toBe(0)
    expect(out.join("\n")).toContain("@wirecat/cli-core, @wirecat/cli-base, commander load from their packages")
    expect(bundled()).not.toContain("sameBase = ")
    expect(bundled()).toContain("toUpperCase")
    const loader = readFileSync(join(root, "dist/bin/demo.js"), "utf8")
    expect(loader).toContain('["@wirecat/cli-core/preload"]')
    expect(loader).not.toContain("@wirecat/cli-base/preload")
    const answer = run([])
    expect(answer.stderr).toBe("")
    expect(JSON.parse(answer.stdout)).toEqual({ core: "core skill", oneBase: true, shout: "HI" })
  })

  it("refuses a range for cli-core or cli-base, since the bundle runs whatever is installed", async () => {
    write(
      "package.json",
      json({ name: "demo", version: "1.2.3", type: "module", dependencies: { "@wirecat/cli-core": "^3.0.0" } }),
    )
    expect(await main(["bundle", "--bin", "dist/bin/demo.js"], io)).toBe(1)
    expect(err.join("\n")).toContain('@wirecat/cli-core is "^3.0.0" in dependencies: pin it exactly')
  })

  it("refuses a shared package the CLI imports but does not depend on", async () => {
    write(
      "package.json",
      json({ name: "demo", version: "1.2.3", type: "module", dependencies: { "@wirecat/cli-core": "3.0.0" } }),
    )
    expect(await main(["bundle", "--bin", "dist/bin/demo.js"], io)).toBe(1)
    expect(err.join("\n")).toContain("@wirecat/cli-base is not in dependencies")
  })

  it("bundles cli-core and cli-base inside with --private-core, as before", async () => {
    expect(await main(["bundle", "--bin", "dist/bin/demo.js", "--private-core"], io)).toBe(0)
    expect(out.join("\n")).not.toContain("load from their packages")
    expect(bundled()).toContain("sameBase = ")
    expect(readFileSync(join(root, "dist/bin/demo.js"), "utf8")).not.toContain("/preload")
    renameSync(join(root, "node_modules/@wirecat/cli-core/dist"), join(root, "node_modules/@wirecat/cli-core/gone"))
    mkdirSync(join(root, "node_modules/@wirecat/cli-core/dist/bundle"), { recursive: true })
    write("node_modules/@wirecat/cli-core/dist/bundle/index.js", "export {}\n")
    expect(JSON.parse(run([]).stdout)).toEqual({ core: "core skill", oneBase: true, shout: "HI" })
  })

  it("keeps cli-core's optional peers outside with --private-core, since a CLI may not install them", async () => {
    const core = JSON.parse(readFileSync(join(root, "node_modules/@wirecat/cli-core/package.json"), "utf8"))
    write(
      "node_modules/@wirecat/cli-core/package.json",
      json({
        ...core,
        peerDependencies: { ...core.peerDependencies, pg: "^8.0.0" },
        peerDependenciesMeta: { pg: { optional: true } },
      }),
    )
    write(
      "node_modules/@wirecat/cli-core/dist/bundle/index.js",
      `${readFileSync(join(root, "node_modules/@wirecat/cli-core/dist/bundle/index.js"), "utf8")}export const database = () => import("pg")\n`,
    )
    expect(await main(["bundle", "--bin", "dist/bin/demo.js", "--private-core"], io)).toBe(0)
    expect(JSON.parse(run([]).stdout).oneBase).toBe(true)
  })
})
