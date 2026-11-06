import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"

const root = join(import.meta.dirname, "..")

const flagged = (source: string): number[] => {
  const probe = mkdtempSync(join(tmpdir(), "no-own-settings-"))
  try {
    mkdirSync(join(probe, "src"))
    cpSync(join(root, "config/lint/no-own-settings.grit"), join(probe, "no-own-settings.grit"))
    writeFileSync(join(probe, "src/context.ts"), source)
    writeFileSync(
      join(probe, "biome.json"),
      JSON.stringify({ linter: { rules: { recommended: false } }, plugins: ["./no-own-settings.grit"] }),
    )
    const { stdout, stderr } = spawnSync(
      join(root, "node_modules/.bin/biome"),
      ["lint", "--max-diagnostics=none", "."],
      {
        cwd: probe,
        encoding: "utf8",
      },
    )
    return [...`${stdout}${stderr}`.matchAll(/^src\/context\.ts:(\d+):\d+ plugin/gm)].map(([, line]) => Number(line))
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

it("flags settings a CLI resolves itself, as beeline's commands did, and nothing handed to baseContext", () => {
  const source = [
    'import { baseContext } from "@wirecat/cli-core/cli"',
    'import { configuration } from "./config.js"',
    "const { resolveSettings } = configuration",
    "export const own = (flags: object, env: object) => configuration.resolveSettings(flags, { env }).profile",
    "export const bare = (env: object) => resolveSettings({}, { env })",
    "export const passed = (command: never) => baseContext(command, configuration.resolveSettings)",
    "export const wrapped = (command: never) =>",
    "  baseContext(command, (flags: object, options: object) => configuration.resolveSettings(flags, { ...options }))",
    "// biome-ignore lint/plugin/no-own-settings: read before any command exists",
    "export const ignored = (env: object) => configuration.resolveSettings({}, { env })",
  ].join("\n")
  expect(flagged(source)).toEqual([4, 5])
})
