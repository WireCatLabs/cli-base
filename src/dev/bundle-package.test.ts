import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import { bundlePackage } from "./bundle-package.js"

let root: string

const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const entry = (name: string) => ({ types: `./dist/${name}.d.ts`, default: `./dist/bundle/${name}.js` })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cli-dev-bundle-package-"))
  write(
    "package.json",
    JSON.stringify({
      name: "lib",
      type: "module",
      exports: {
        ".": entry("index"),
        "./extra": entry("extra"),
        "./preload": { default: "./dist/bundle/preload.js" },
        "./data.txt": "./data.txt",
      },
      dependencies: { inner: "1.0.0" },
      peerDependencies: { peer: "1.0.0" },
    }),
  )
  write(
    "dist/index.js",
    `import { readFileSync } from "node:fs"
import { state } from "./state.js"
import { twice } from "inner"
import { peer } from "peer"
export const said = "import.meta.url"
export const data = () => readFileSync(new URL("../data.txt", import.meta.url), "utf8").trim()
export const late = () => import("./late.js")
export { peer, state, twice }
`,
  )
  write("dist/extra.js", `export { state } from "./state.js"\n`)
  write("dist/state.js", "export const state = {}\n")
  write("dist/late.js", `export const late = "late"\n`)
  write("data.txt", "beside the package\n")
  write("node_modules/inner/package.json", JSON.stringify({ name: "inner", type: "module", exports: "./index.js" }))
  write("node_modules/inner/index.js", "export const twice = (text) => text + text\n")
  write("node_modules/peer/package.json", JSON.stringify({ name: "peer", type: "module", exports: "./index.js" }))
  write("node_modules/peer/index.js", `export const peer = "outside"\n`)
})

const load = (name: string) => import(pathToFileURL(join(root, "dist/bundle", `${name}.js`)).href)

describe("bundlePackage", () => {
  it("builds every export into one bundle, each module keeping its place and its state shared", async () => {
    const { problems, chunks } = await bundlePackage({ root })
    expect(problems).toEqual([])
    expect(chunks).toEqual(expect.arrayContaining(["./extra.js", "./index.js", expect.stringMatching(/^\.\/late-/)]))
    renameSync(join(root, "dist/state.js"), join(root, "dist/state.js.gone"))
    const index = await load("index")
    const extra = await load("extra")
    expect(index.state).toBe(extra.state)
    expect(index.data()).toBe("beside the package")
    expect(index.said).toBe("import.meta.url")
    expect(index.twice("a")).toBe("aa")
    expect((await index.late()).late).toBe("late")
    const files = readdirSync(join(root, "dist/bundle"))
    const code = files.map((file) => readFileSync(join(root, "dist/bundle", file), "utf8")).join("\n")
    expect(code).toContain('from "peer"')
    expect(code).toContain("text + text")
  })

  it("writes ./preload and chunks.json; a preloaded process survives an upgrade that deletes the bundle", async () => {
    write("dist/quiet.js", `throw new Error("imported")\n`)
    write(
      "package.json",
      JSON.stringify({
        ...JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
        exports: {
          ".": entry("index"),
          "./quiet": entry("quiet"),
          "./preload": { default: "./dist/bundle/preload.js" },
        },
      }),
    )
    const { chunks } = await bundlePackage({ root, quiet: ["quiet"] })
    expect(JSON.parse(readFileSync(join(root, "dist/bundle/chunks.json"), "utf8"))).toEqual(chunks)
    expect(chunks).not.toContain("./quiet.js")
    expect(chunks).not.toContain("./preload.js")
    const upgrade = (preload: boolean) =>
      spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { rmSync } from "node:fs"
const bundle = ${JSON.stringify(join(root, "dist/bundle"))}
const index = await import(bundle + "/index.js")
if (${preload}) await (await import(bundle + "/preload.js")).preload()
rmSync(bundle, { recursive: true })
console.log((await index.late()).late)`,
        ],
        { encoding: "utf8" },
      )
    const gone = upgrade(false)
    expect(gone.stderr).toContain("ERR_MODULE_NOT_FOUND")
    await bundlePackage({ root, quiet: ["quiet"] })
    const kept = upgrade(true)
    expect(kept.stderr).toBe("")
    expect(kept.stdout).toBe("late\n")
  })

  it("merges what the start entries load statically into one chunk", async () => {
    const { problems } = await bundlePackage({ root, merge: ["index"] })
    expect(problems).toEqual([])
    const files = readdirSync(join(root, "dist/bundle")).filter((file) => file.endsWith(".js"))
    expect(files.filter((file) => file.startsWith("state-"))).toEqual([])
    const index = await load("index")
    expect(index.state).toBe((await load("extra")).state)
    expect(index.data()).toBe("beside the package")
    expect((await index.late()).late).toBe("late")
  })

  it("gives each ordered merge group its own chunk, so a small entry does not load a large one's", async () => {
    expect((await bundlePackage({ root, merge: [["extra"], ["index"]] })).problems).toEqual([])
    const bundle = join(root, "dist/bundle")
    const read = (file: string) => readFileSync(join(bundle, file), "utf8")
    const reached = new Set<string>()
    const stack = ["extra.js"]
    for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
      if (reached.has(file)) continue
      reached.add(file)
      stack.push(...[...read(file).matchAll(/(?:import|from)\s*"\.\/([^"]+)"/g)].map(([, next]) => next ?? ""))
    }
    expect([...reached].some((file) => read(file).includes("text + text"))).toBe(false)
    const index = await load("index")
    expect(index.state).toBe((await load("extra")).state)
    expect(index.twice("a")).toBe("aa")
  })

  it("refuses an outside import that is not the package's own dependency, which no install puts beside it", async () => {
    write("dist/extra.js", `export { state } from "./state.js"\nexport { Database } from "better-sqlite3"\n`)
    const { problems } = await bundlePackage({ root })
    expect(problems.join("\n")).toContain("imports better-sqlite3, which is not a dependency of this package")
  })

  it("adds an entry that is not an export, such as a bin, keeping its #! first", async () => {
    write(
      "dist/bin.js",
      `#!/usr/bin/env node\nimport { state } from "./state.js"\nconsole.log(import.meta.url, state)\n`,
    )
    await bundlePackage({ root, entries: { tool: "dist/bin.js" } })
    expect(readFileSync(join(root, "dist/bundle/tool.js"), "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true)
  })
})
