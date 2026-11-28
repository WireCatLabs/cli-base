import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "esbuild"
import { describe, expect, it } from "vitest"
import * as dev from "./index.js"

describe("@wirecat/cli-base/dev", () => {
  it("exports what cli-core's bundle script imports", () => {
    expect(Object.keys(dev).sort()).toEqual([
      "DEFAULT_EXTERNAL",
      "DEFAULT_HARMLESS",
      "bundle",
      "bundlePackage",
      "commonJsNames",
      "ownPlaces",
    ])
    expect(dev.DEFAULT_EXTERNAL).toContain("@napi-rs/*")
    expect(dev.DEFAULT_HARMLESS).toContain("/commander/lib/command.js")
    expect(dev.commonJsNames.name).toBe("common-js-names")
  })

  it("keeps a module's place with no anchored packages, as a package bundling itself uses it", async () => {
    const root = mkdtempSync(join(tmpdir(), "cli-dev-own-places-"))
    const dist = join(root, "dist")
    const out = join(dist, "bundle")
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
    writeFileSync(join(root, "data.txt"), "beside the package\n")
    writeFileSync(
      join(dist, "index.js"),
      `import { readFileSync } from "node:fs"\nexport const data = () => readFileSync(new URL("../data.txt", import.meta.url), "utf8").trim()\n`,
    )
    const problems: string[] = []
    await build({
      entryPoints: [join(dist, "index.js")],
      outdir: out,
      bundle: true,
      format: "esm",
      platform: "node",
      plugins: [dev.ownPlaces({ dist, out, problems })],
      logLevel: "silent",
    })
    expect(problems).toEqual([])
    expect(readFileSync(join(out, "index.js"), "utf8")).toContain('new URL("../index.js", import.meta.url)')
    const loaded = await import(pathToFileURL(join(out, "index.js")).href)
    expect(loaded.data()).toBe("beside the package")
  })
})
