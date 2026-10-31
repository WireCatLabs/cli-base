import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { BUILT_IN_COMMANDS, PROGRAM_PREFIX, TOOL_NAME } from "./names.js"

/** The system `wcat` runs on and the variables it searches; tests pass another platform's. */
export interface SearchEnv {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
}

const variable = (env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform) =>
  platform === "win32" ? Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1] : env[name]

/** Each folder once: a folder listed twice is one program, not two. */
export const pathEntries = ({ env, platform }: SearchEnv): string[] => {
  const raw = variable(env, "PATH", platform) ?? ""
  const entries = raw.split(platform === "win32" ? ";" : ":").map((entry) => entry.replace(/^"(.*)"$/, "$1"))
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = platform === "win32" ? entry.toLowerCase().replace(/[\\/]+$/, "") : entry.replace(/\/+$/, "")
    if (entry === "" || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The endings Windows runs without being told, `.cmd` before `.ps1` when PATHEXT says so; none elsewhere. */
export const programExtensions = ({ env, platform }: SearchEnv): string[] =>
  platform === "win32"
    ? (variable(env, "PATHEXT", platform) ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .filter((ext) => /^\.[a-z0-9]+$/i.test(ext))
        .map((ext) => ext.toLowerCase())
    : [""]

const isProgram = (path: string, platform: NodeJS.Platform): boolean => {
  try {
    const stat = statSync(path)
    return stat.isFile() && (platform === "win32" || (stat.mode & 0o111) !== 0)
  } catch {
    return false
  }
}

/** Every `command` on PATH, in PATH order, one file per folder: the first ending Windows would run. */
export const findOnPath = (command: string, search: SearchEnv): string[] => {
  const extensions = programExtensions(search)
  return pathEntries(search).flatMap((dir) => {
    for (const extension of extensions) {
      const path = join(dir, command + extension)
      if (isProgram(path, search.platform)) return [path]
    }
    return []
  })
}

/** Every `wcat-<name>` program on PATH by name, each with its files in PATH order. */
export const findTools = (search: SearchEnv): Map<string, string[]> => {
  const extensions = programExtensions(search)
  const tools = new Map<string, string[]>()
  for (const dir of pathEntries(search)) {
    let files: string[]
    try {
      files = readdirSync(dir)
    } catch {
      continue
    }
    const here = new Map<string, string>()
    for (const file of files) {
      if (!(search.platform === "win32" ? file.toLowerCase() : file).startsWith(PROGRAM_PREFIX)) continue
      const extension = extensions.find((ext) => ext !== "" && file.toLowerCase().endsWith(ext)) ?? ""
      if (search.platform === "win32" && extension === "") continue
      const base = search.platform === "win32" ? file.toLowerCase() : file
      const name = base.slice(PROGRAM_PREFIX.length, base.length - extension.length)
      if (!TOOL_NAME.test(name)) continue
      const best = here.get(name)
      const rank = (path: string) => extensions.findIndex((ext) => path.toLowerCase().endsWith(ext))
      const path = join(dir, file)
      if (best !== undefined && rank(best) <= rank(path)) continue
      if (isProgram(path, search.platform)) here.set(name, path)
    }
    for (const [name, path] of here) tools.set(name, [...(tools.get(name) ?? []), path])
  }
  return new Map([...tools].sort(([a], [b]) => (a < b ? -1 : 1)))
}

/** Names `wcat` answers itself; a `wcat-<name>` program with one of them never runs through `wcat`. */
export const isBuiltIn = (name: string): boolean =>
  name === "wcat" || (BUILT_IN_COMMANDS as readonly string[]).includes(name)
