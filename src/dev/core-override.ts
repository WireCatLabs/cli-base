/**
 * WC-TOOL-21: a CLI pins `@wirecat/cli-core` X.Y.Z in package.json, which is what its users install, and overrides it
 * to X.Y.Z-dev in pnpm-workspace.yaml, which only the CLI's own checkout reads. X.Y.Z ships no type files; X.Y.Z-dev
 * is the same JavaScript with the types, their maps and src/.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseDocument } from "yaml"

export const CORE = "@wirecat/cli-core"
export const DEV_SUFFIX = "-dev"
const WORKSPACE = "pnpm-workspace.yaml"
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

interface Manifest {
  name?: string
  bin?: unknown
  dependencies?: Record<string, string>
}

const readManifest = (root: string): Manifest => JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

/** The CLI's pin when the rule applies to it: cli-core itself, and a package with no `bin`, are not CLIs. */
const pinOf = (pkg: Manifest): string | undefined =>
  pkg.name === CORE || pkg.bin === undefined ? undefined : pkg.dependencies?.[CORE]

const overrideOf = (root: string): string | undefined => {
  const path = join(root, WORKSPACE)
  if (!existsSync(path)) return undefined
  const value = parseDocument(readFileSync(path, "utf8")).getIn(["overrides", CORE])
  return value === undefined || value === null ? undefined : String(value)
}

const line = (pin: string) => `  "${CORE}": ${pin}${DEV_SUFFIX}`

export interface OverrideCheck {
  problems: string[]
  notes: string[]
}

/**
 * Problems are a wrong override, or none while the installed cli-core is the user package (no `dist/index.d.ts`):
 * that one is published only beside its -dev twin, so the override can be added. An older cli-core, released before
 * the twins, still ships its types and has no -dev to point at; then the missing override is only a note.
 */
export const coreOverrideCheck = (root: string): OverrideCheck => {
  const pin = pinOf(readManifest(root))
  if (pin === undefined) return { problems: [], notes: [] }
  if (!EXACT.test(pin))
    return { problems: [`package.json gives ${CORE} as "${pin}": pin the exact version, such as 2.1.0`], notes: [] }
  const override = overrideOf(root)
  const wanted = `${pin}${DEV_SUFFIX}`
  if (override === wanted) return { problems: [], notes: [] }
  if (override !== undefined)
    return {
      problems: [
        `${WORKSPACE} overrides ${CORE} to ${override}, but package.json pins ${pin}, so this repository builds and ` +
          `tests against a cli-core its users never get. Change that line under "overrides:" to\n${line(pin)}\n` +
          "and run `pnpm install` (WC-TOOL-21).",
      ],
      notes: [],
    }
  const installed = join(root, "node_modules", CORE)
  if (existsSync(join(installed, "package.json")) && !existsSync(join(installed, "dist/index.d.ts")))
    return {
      problems: [
        `${WORKSPACE} does not override ${CORE}. ${pin} is the package users install and has no type files, so ` +
          `\`pnpm typecheck\` fails with TS7016 ("Could not find a declaration file for module '${CORE}'"). ` +
          `Add this line under "overrides:" in ${WORKSPACE}\n${line(pin)}\nand run \`pnpm install\` (WC-TOOL-21).`,
      ],
      notes: [],
    }
  return {
    problems: [],
    notes: [`${CORE} ${pin} predates the -dev releases; from the next cli-core, \`cli-dev adopt\` adds the override`],
  }
}

/** Points the override at `version`-dev, as `adopt` does with the pin; keeps the file's other lines and comments. */
export const writeCoreOverride = (root: string, version: string): void => {
  const path = join(root, WORKSPACE)
  const doc = parseDocument(existsSync(path) ? readFileSync(path, "utf8") : "")
  doc.setIn(["overrides", CORE], `${version}${DEV_SUFFIX}`)
  writeFileSync(path, String(doc))
}

export const needsCoreOverride = (root: string): boolean => pinOf(readManifest(root)) !== undefined
