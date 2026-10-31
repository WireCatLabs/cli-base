import { closeSync, openSync, readSync, realpathSync, rmSync } from "node:fs"
import { basename, dirname } from "node:path"
import { CliError } from "../errors.js"
import { findOnPath, findTools, isBuiltIn, type SearchEnv } from "./path.js"
import { fileState, shimFiles, writeShim } from "./shim.js"

/**
 * - `made`: the short name is a shortcut cli-base made, and `remove` may take it out.
 * - `free`: no program on PATH has the name, so `add` may make it.
 * - `package`: the tool's package installs the short name itself; the package manager owns it.
 * - `taken`: another program has the name; it is never touched.
 */
export type ShortcutStatus = "made" | "free" | "package" | "taken"

export interface Shortcut {
  /** The short name, which is also the tool's name: `tg`. */
  name: string
  status: ShortcutStatus
  /** The file that has the name, for every status but `free`. */
  path?: string
  /** The `wcat-<name>` program the shortcut starts. */
  program: string
}

export interface ShortcutChange extends Shortcut {
  changed: boolean
}

const WIRECAT_PACKAGE = /node_modules[\\/]+@wirecat[\\/]/

/** A link into an `@wirecat/*` package, or a package manager's wrapper that starts one (npm on Windows, pnpm). */
const isWirecatPackage = (path: string): boolean => {
  try {
    if (WIRECAT_PACKAGE.test(realpathSync(path))) return true
    const buffer = Buffer.alloc(16 * 1024)
    const fd = openSync(path, "r")
    try {
      const read = readSync(fd, buffer, 0, buffer.length, 0)
      return WIRECAT_PACKAGE.test(buffer.subarray(0, read).toString("latin1"))
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
}

const ourShortcut = (path: string): boolean => {
  const state = fileState(path)
  return state.state === "ours" && state.mark.kind === "shortcut"
}

const statusOf = (name: string, program: string, search: SearchEnv): Shortcut => {
  const files = shimFiles("shortcut", {
    dir: dirname(program),
    name,
    target: basename(program),
    platform: search.platform,
  })
  const named = findOnPath(name, search)
  const made = [...files.map((file) => file.path), ...named].find(ourShortcut)
  if (made) return { name, status: "made", path: made, program }
  const first = named[0]
  if (first === undefined) return { name, status: "free", program }
  return { name, status: isWirecatPackage(first) ? "package" : "taken", path: first, program }
}

/** A bin folder only an administrator may change is the usual cause, and the person can act on it. */
const changeFile = (path: string, change: () => void): void => {
  try {
    change()
  } catch (error) {
    throw new CliError(
      "permission_error",
      `could not change ${path}: ${(error as NodeJS.ErrnoException).code ?? error}`,
      {
        reason: "access.denied",
      },
    )
  }
}

/** Every installed `wcat-<name>` program by name, the first on PATH for each, built-in names left out. */
export const installedPrograms = (search: SearchEnv): Map<string, string[]> =>
  new Map([...findTools(search)].filter(([name]) => !isBuiltIn(name)))

const chosen = (names: readonly string[] | undefined, search: SearchEnv): [string, string][] => {
  const installed = installedPrograms(search)
  if (names === undefined || names.length === 0)
    return [...installed].map(([name, paths]) => [name, paths[0] as string])
  const missing = names.filter((name) => !installed.has(name))
  if (missing.length > 0)
    throw new CliError("not_found", `not installed: ${missing.map((name) => `wcat-${name}`).join(", ")}`, {
      reason: "tool.not-installed",
      tool: missing[0],
      installed: [...installed.keys()],
    })
  return [...new Set(names)].map((name) => [name, (installed.get(name) as string[])[0] as string])
}

/** The short name of each installed tool, or of the tools named: made, free, installed by the package or taken. */
export const listShortcuts = (search: SearchEnv, names?: readonly string[]): Shortcut[] =>
  chosen(names, search).map(([name, program]) => statusOf(name, program, search))

/**
 * Makes a shortcut for each free name, in the folder of the program it starts. Only a name no program on PATH has is
 * made, so a shortcut never hides another program and never sits in front of one.
 */
export const addShortcuts = (search: SearchEnv, names?: readonly string[]): ShortcutChange[] =>
  listShortcuts(search, names).map((shortcut) => {
    if (shortcut.status !== "free") return { ...shortcut, changed: false }
    const files = shimFiles("shortcut", {
      dir: dirname(shortcut.program),
      name: shortcut.name,
      target: basename(shortcut.program),
      platform: search.platform,
    })
    for (const file of files) changeFile(file.path, () => writeShim(file))
    return { ...shortcut, status: "made", path: files[0]?.path, changed: true }
  })

/** Removes the shortcuts cli-base made; a file it did not make stays, whatever its name. */
export const removeShortcuts = (search: SearchEnv, names?: readonly string[]): ShortcutChange[] =>
  listShortcuts(search, names).map((shortcut) => {
    if (shortcut.status !== "made") return { ...shortcut, changed: false }
    const files = shimFiles("shortcut", {
      dir: dirname(shortcut.path as string),
      name: shortcut.name,
      target: basename(shortcut.program),
      platform: search.platform,
    })
    for (const file of files)
      if (ourShortcut(file.path)) changeFile(file.path, () => rmSync(file.path, { force: true }))
    return { ...statusOf(shortcut.name, shortcut.program, search), changed: true }
  })
