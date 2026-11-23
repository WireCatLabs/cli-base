import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { apiReports, statementsOf } from "./api-report.js"
import { type DevIo, main } from "./main.js"

let root: string
let out: string[]
let err: string[]
let io: DevIo

const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const pkg = (stable?: string[]) =>
  write(
    "package.json",
    JSON.stringify({
      name: "@acme/lib",
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
        "./extra": { types: "./dist/extra.d.ts", default: "./dist/extra.js" },
        "./biome": "./config/biome.json",
      },
      ...(stable ? { wirecat: { stable } } : {}),
    }),
  )

const run = async (...args: string[]) => main(["api-report", "--skip-build", ...args], io)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cli-dev-api-"))
  out = []
  err = []
  io = { cwd: root, out: (text) => out.push(text), err: (text) => err.push(text) }
  write(
    "dist/index.d.ts",
    [
      'export { open, type Options, preview, Handle, renamed as alias } from "./open.js";',
      '/** @experimental the whole re-export */ export { draft } from "./open.js";',
      'export type { Shape } from "valibot";',
    ].join("\n"),
  )
  write(
    "dist/open.d.ts",
    [
      "declare const schema: Inner;",
      "type Inner = { size: number };",
      "/** Opens it. */",
      "export interface Options {",
      "    /** How long. */",
      "    timeout?: number;",
      "    shape: typeof schema;",
      "}",
      "export declare function open(path: string): void;",
      "export declare function open(path: string, options: Options): void;",
      "/**",
      " * Not settled yet.",
      " * @experimental",
      " */",
      "export declare const preview: () => void;",
      "/** @deprecated use open */",
      "export declare const renamed: string;",
      "export declare const draft: number;",
      "export declare class Handle<T extends { id: string }> {",
      "    private secret;",
      "    readonly id: T;",
      "}",
      "//# sourceMappingURL=open.d.ts.map",
    ].join("\n"),
  )
  write("dist/extra.d.ts", "export {};\n")
})

describe("api-report", () => {
  it("does nothing for a package that lists no stable entry points", async () => {
    pkg()
    expect(await run("--check")).toBe(0)
    expect(out.join("\n")).toMatch(/no "wirecat.stable"/)
    expect(existsSync(join(root, "api"))).toBe(false)
  })

  it("writes one sorted report per stable entry, following re-exports and leaving out @experimental names", async () => {
    pkg(["."])
    expect(await run()).toBe(0)
    expect(readFileSync(join(root, "api/index.api.txt"), "utf8")).toBe(
      [
        '# @acme/lib ".": the stable API, written by cli-dev api-report. Do not edit.',
        "Handle · class · export declare class Handle<T extends { id: string }> {",
        "Handle · class · readonly id: T;",
        "Handle · class · }",
        "Options · interface · export interface Options {",
        "Options · interface · timeout?: number;",
        "Options · interface · shape: typeof schema;",
        "Options · interface · }",
        "Options · interface · declare const schema: Inner;",
        "Options · interface · type Inner = { size: number };",
        'Shape · re-export · export { Shape } from "valibot"',
        "alias · const · export declare const renamed: string;",
        "open · function · export declare function open(path: string): void;",
        "open · function · export declare function open(path: string, options: Options): void;",
        "",
      ].join("\n"),
    )
  })

  it("passes --check while the committed report matches, and fails a stale or leftover one", async () => {
    pkg(["."])
    await run()
    expect(await run("--check")).toBe(0)
    write("dist/open.d.ts", readFileSync(join(root, "dist/open.d.ts"), "utf8").replace("timeout?", "timeoutMs?"))
    write("api/old.api.txt", "# gone\n")
    expect(await run("--check")).toBe(1)
    expect(err).toEqual([
      "api/index.api.txt differs from the build: run cli-dev api-report and commit it",
      "api/old.api.txt reports no stable entry point any more: run cli-dev api-report",
    ])
  })

  it("names a stable entry that is not an export, has no types, or is not built", () => {
    pkg([".", "./biome", "./missing"])
    expect(apiReports(root).problems).toEqual([
      'package.json: stable entry "./biome" has no "types" file to report on',
      'package.json: "wirecat.stable" lists "./missing", which is not an "exports" key',
    ])
    pkg(["./extra"])
    write("dist/extra.d.ts", 'export * as ns from "./open.js";\n')
    expect(apiReports(root).problems).toEqual([
      expect.stringMatching(/extra\.d\.ts: cli-dev api-report cannot read "export \* as ns/),
    ])
  })

  it("splits statements at a body's closing brace and keeps each one's doc comment", () => {
    expect(statementsOf("/** a */\nexport interface A {\n  b: { c: 1 }\n}\nexport type D = 1;\n")).toEqual([
      { text: "export interface A {\n  b: { c: 1 }\n}", doc: "/** a */" },
      { text: "export type D = 1;", doc: "" },
    ])
  })
})
