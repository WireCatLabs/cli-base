import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import spawn from "cross-spawn"
import type { ParityGroup } from "../standards/audit.js"
import { FIRST_PARTY_TOOLS } from "../wcat/names.js"

/** The published CLIs `audit --family` installs; beeline is not on npm yet. */
const PACKAGES = new Map<string, string>([
  ...FIRST_PARTY_TOOLS.flatMap((tool) => (tool.package ? [[tool.name, tool.package] as [string, string]] : [])),
  ["gcal", "@wirecat/gcal-cli"],
  ["b24", "@wirecat/bitrix24-cli"],
])

/** Every other CLI of the parity groups that npm has, by name. */
export const familyPackages = (groups: readonly ParityGroup[], own: string): Map<string, string> =>
  new Map(
    [...new Set(groups.flatMap((group) => group.members))]
      .filter((name) => name !== own && PACKAGES.has(name))
      .sort()
      .map((name) => [name, PACKAGES.get(name) as string]),
  )

export interface Family {
  /** Each installed CLI's bin, by name. */
  bins: Map<string, string>
  close: () => void
}

/** Installs the latest published `packages` into a folder of their own, without their install scripts. */
export const installFamily = (packages: ReadonlyMap<string, string>): Family => {
  const prefix = mkdtempSync(join(tmpdir(), "cli-dev-family-"))
  const close = () => rmSync(prefix, { recursive: true, force: true })
  const run = spawn.sync(
    "npm",
    [
      "install",
      "--global",
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--loglevel",
      "error",
      "--fetch-retries",
      "6",
      ...packages.values(),
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  )
  if (run.error || run.status !== 0) {
    close()
    throw new Error(`npm install of the family failed: ${run.error?.message ?? String(run.stderr).trim()}`)
  }
  const bin = process.platform === "win32" ? prefix : join(prefix, "bin")
  return { bins: new Map([...packages.keys()].map((name) => [name, join(bin, name)])), close }
}
