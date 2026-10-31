import { readFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { installerOf } from "../installer.js"
import { PROGRAM_PREFIX } from "./names.js"
import { exists, type FileState, fileState, SHIM_FORMAT, shimFiles, writeShim } from "./shim.js"

export interface BinFolderInput {
  /** The tool's name in `wcat <name>`: `tg`. */
  name: string
  /** `process.argv[1]`: the command as it was started, which is the bin folder's own link where npm makes one. */
  argv1?: string
  /** A file of the installed package, links resolved: where it lives says which package manager put it there. */
  script: string
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
}

export interface BinFolder {
  dir: string
  /** The tool's own command in it, `wcat-tg` or `wcat-tg.cmd`. */
  program: string
}

const posix = (path: string) => path.replaceAll("\\", "/")

/** pnpm's global packages live under PNPM_HOME, whatever the folder is called; a project's own `.pnpm` does not. */
const pnpmHome = (path: string, env: NodeJS.ProcessEnv): string | undefined => {
  const home = env.PNPM_HOME
  return home && path.startsWith(`${posix(home).replace(/\/+$/, "")}/`) ? home : undefined
}

/** Where each package manager puts the commands of a global install, read from where the package itself lives. */
const layoutFolders = (script: string, env: NodeJS.ProcessEnv): string[] => {
  const path = posix(script)
  const home = pnpmHome(path, env)
  // pnpm 12 puts global commands in $PNPM_HOME/bin, earlier versions in $PNPM_HOME itself.
  if (home) return [join(home, "bin"), home]
  switch (installerOf(script)) {
    case "bun":
      return [`${path.slice(0, path.indexOf("/install/global/node_modules/"))}/bin`]
    case "npm": {
      const root = path.slice(0, path.indexOf("/node_modules/"))
      // `<prefix>/lib/node_modules` with `<prefix>/bin` on Linux and macOS; `<prefix>/node_modules` beside the
      // commands on Windows.
      return [basename(root) === "lib" ? join(dirname(root), "bin") : root]
    }
    default:
      return []
  }
}

/**
 * The global bin folder the running tool was installed into, or `undefined` for npx, a checkout or a project's own
 * `node_modules/.bin`. At most four `stat` calls, so it can run on every start.
 */
export const binFolder = ({ name, argv1, script, env, platform }: BinFolderInput): BinFolder | undefined => {
  if (!["npm", "pnpm", "bun"].includes(installerOf(script)) && !pnpmHome(posix(script), env)) return undefined
  const extensions = platform === "win32" ? [".cmd", ".exe"] : [""]
  const candidates = [argv1 ? dirname(argv1) : undefined, ...layoutFolders(script, env)]
  for (const dir of new Set(candidates)) {
    if (dir === undefined || basename(dir) === ".bin") continue
    for (const extension of extensions) {
      const program = `${PROGRAM_PREFIX}${name}${extension}`
      if (exists(join(dir, program))) return { dir, program }
    }
  }
  return undefined
}

/**
 * Whether the program in `dir` still starts something. bun on Windows leaves a tool's `.exe` behind when the tool is
 * uninstalled; the `.bunx` beside it names the script, as UTF-16 text up to a `"`, and that script is gone.
 */
export const installed = (dir: string, program: string): boolean => {
  if (!exists(join(dir, program))) return false
  if (!program.toLowerCase().endsWith(".exe")) return true
  let script: string
  try {
    script =
      readFileSync(join(dir, `${program.slice(0, -4)}.bunx`))
        .toString("utf16le")
        .split('"')[0] ?? ""
  } catch {
    return true
  }
  if (script === "" || exists(resolve(dir, script))) return true
  // The relative path did not resolve; bun's default layout puts the packages in <BUN_INSTALL>/install/global.
  const at = posix(script).lastIndexOf("/install/global/node_modules/")
  return at < 0 || exists(join(dirname(dir), posix(script).slice(at + 1)))
}

/**
 * - `kept`: the launcher is there and starts a tool that is installed.
 * - `written`: it was missing, broken or in an older format, and now starts the running tool.
 * - `foreign`: a `wcat` that cli-base did not write is there, and stays untouched.
 * - `newer`: a newer cli-base wrote it; this one leaves it alone.
 * - `failed`: it could not be written, such as a bin folder only an administrator may change.
 */
export type LauncherState = "kept" | "written" | "foreign" | "newer" | "failed"

const NAME = "wcat"

/**
 * Makes sure the `wcat` launcher in `dir` starts an installed tool. It never prints and never throws: a tool calls it
 * on every start, and a launcher it cannot write must not fail the tool's own command.
 */
export const ensureLauncher = ({
  dir,
  program,
  platform,
}: BinFolder & { platform: NodeJS.Platform }): LauncherState => {
  try {
    const mine = shimFiles("launcher", { dir, name: NAME, target: program, platform })
    const states: FileState[] = mine.map((file) => fileState(file.path))
    if (states.some((one) => one.state === "foreign")) return "foreign"
    const ours = states.flatMap((one) => (one.state === "ours" ? [one] : []))
    if (ours.some(({ mark }) => mark.format > SHIM_FORMAT)) return "newer"
    if (ours.some(({ mark }) => mark.kind !== "launcher")) return "foreign"
    // Keep the tool it starts while that tool is installed, so two tools never take turns rewriting it.
    const current = ours.find(({ mark }) => installed(dir, mark.target))?.mark.target
    const wanted = shimFiles("launcher", { dir, name: NAME, target: current ?? program, platform })
    const stale = wanted.filter((file, at) => {
      const state = states[at]
      return state?.state !== "ours" || state.text !== file.text
    })
    if (stale.length === 0) return "kept"
    for (const file of stale) writeShim(file)
    return "written"
  } catch {
    return "failed"
  }
}
