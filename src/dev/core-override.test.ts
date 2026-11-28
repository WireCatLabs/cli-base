import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { coreOverrideCheck, writeCoreOverride } from "./core-override.js"
import { type DevIo, main } from "./main.js"

let root: string

const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}
const cli = (pin: string, extra: Record<string, unknown> = {}) =>
  write(
    "package.json",
    JSON.stringify({
      name: "@wirecat/x-cli",
      bin: { x: "dist/x.js" },
      ...extra,
      dependencies: { "@wirecat/cli-core": pin },
    }),
  )
const workspace = (override?: string) =>
  write(
    "pnpm-workspace.yaml",
    `# keep me\nallowBuilds:\n  esbuild: true\noverrides:\n${override ? `  "@wirecat/cli-core": ${override}\n` : ""}  katex: ^0.18.2\n`,
  )
const installed = (types: boolean) => {
  write("node_modules/@wirecat/cli-core/package.json", "{}")
  if (types) write("node_modules/@wirecat/cli-core/dist/index.d.ts", "export {}")
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "core-override-"))
})

describe("the cli-core -dev override (WC-TOOL-21)", () => {
  it("passes when the override is the pin plus -dev", () => {
    cli("2.1.0")
    workspace("2.1.0-dev")
    installed(true)
    expect(coreOverrideCheck(root)).toEqual({ problems: [], notes: [] })
  })

  it("fails on an override to another version, naming the line to write", () => {
    cli("2.2.0")
    workspace("2.1.0-dev")
    const [problem] = coreOverrideCheck(root).problems
    expect(problem).toContain("overrides @wirecat/cli-core to 2.1.0-dev, but package.json pins 2.2.0")
    expect(problem).toContain('\n  "@wirecat/cli-core": 2.2.0-dev\n')
  })

  it("fails on a missing override once the installed cli-core is the user package, with no types", () => {
    cli("2.1.0")
    workspace()
    installed(false)
    const [problem] = coreOverrideCheck(root).problems
    expect(problem).toContain("TS7016")
    expect(problem).toContain(
      'Add this line under "overrides:" in pnpm-workspace.yaml\n  "@wirecat/cli-core": 2.1.0-dev\n',
    )
  })

  it("only notes a missing override while the pinned cli-core predates the -dev releases", () => {
    cli("2.0.0")
    workspace()
    installed(true)
    expect(coreOverrideCheck(root)).toMatchObject({ problems: [], notes: [expect.stringContaining("predates")] })
  })

  it("leaves out cli-core itself, a package with no bin, and one with cli-core only as a dev dependency", () => {
    cli("2.1.0", { name: "@wirecat/cli-core" })
    expect(coreOverrideCheck(root).problems).toEqual([])
    write("package.json", JSON.stringify({ name: "lib", dependencies: { "@wirecat/cli-core": "2.1.0" } }))
    expect(coreOverrideCheck(root).problems).toEqual([])
    write("package.json", JSON.stringify({ name: "docs", bin: {}, devDependencies: { "@wirecat/cli-core": "2.1.0" } }))
    expect(coreOverrideCheck(root).problems).toEqual([])
  })

  it("writes the override and keeps the file's other lines", () => {
    workspace("2.0.0-dev")
    writeCoreOverride(root, "2.1.0")
    const text = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")
    expect(text).toContain("# keep me")
    expect(text).toContain("katex: ^0.18.2")
    expect(text).toMatch(/"@wirecat\/cli-core": 2\.1\.0-dev/)
  })

  it("is moved by `adopt` together with the pin", async () => {
    const { adopt } = await import("./adopt.js")
    cli("2.0.0")
    workspace()
    expect(
      adopt(
        root,
        "@wirecat/cli-core",
        "2.1.0",
        () => 0,
        () => {},
      ),
    ).toBe(0)
    installed(false)
    expect(coreOverrideCheck(root)).toEqual({ problems: [], notes: [] })
  })

  it("makes `cli-dev version` fail on a wrong override", async () => {
    cli("2.2.0")
    workspace("2.1.0-dev")
    write("src/version.ts", 'export const VERSION = "1.0.0"\n')
    write(
      "package.json",
      JSON.stringify({ ...JSON.parse(readFileSync(join(root, "package.json"), "utf8")), version: "1.0.0" }),
    )
    const err: string[] = []
    const io: DevIo = { cwd: root, out: () => {}, err: (text) => err.push(text) }
    expect(await main(["version"], io)).toBe(1)
    expect(err.join("\n")).toContain("WC-TOOL-21")
  })

  it("checks only the override with --cli-core-only, as node-ci does before typecheck", async () => {
    cli("2.2.0")
    workspace("2.1.0-dev")
    const err: string[] = []
    const io: DevIo = { cwd: root, out: () => {}, err: (text) => err.push(text) }
    expect(await main(["version", "--cli-core-only"], io)).toBe(1)
    expect(err).toHaveLength(1)
    expect(err[0]).toContain("WC-TOOL-21")
  })
})
