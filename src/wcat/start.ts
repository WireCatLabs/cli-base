/**
 * The part of `wcat` a CLI loads on every start, kept to Node built-ins: answering `--wcat-describe`, handing over to
 * the dispatcher when the launcher asks, and otherwise checking the `wcat` launcher with a few `stat` calls.
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describeAnswer, type ShippedManifest, type WcatTool } from "./describe.js"
import { binFolder, ensureLauncher, type LauncherState } from "./launcher.js"
import { DESCRIBE_FLAG, DISPATCH_FLAG } from "./names.js"

export interface WcatStartIo {
  /** `process.argv`: the runtime, the script, then the words. */
  argv: readonly string[]
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  stdout: { write: (text: string) => unknown; isTTY?: boolean }
  stderr: { write: (text: string) => unknown; isTTY?: boolean }
  /** A file of the installed package, links resolved; cli-base's own file, which sits in the same install. */
  script: string
}

export interface WcatStart {
  /** The exit code when `wcat` handled this start (`--wcat-describe`, or dispatch mode); `undefined` otherwise. */
  code?: number
  /** What happened to the `wcat` launcher on a normal start; `undefined` when the tool is not a global install. */
  launcher?: LauncherState
}

/**
 * The first call in a CLI's bin, before its program loads:
 *
 * ```ts
 * const { code } = await wcatStart({ command: "tg", version, description })
 * if (code !== undefined) process.exitCode = code
 * else await startCli(…)
 * ```
 *
 * - `wcat-tg --wcat-describe` prints the tool's description as JSON for `wcat --help`, in format 2 when the package
 *   ships `contracts/wirecat.json`.
 * - `wcat-tg --wcat-dispatch …`, which only the launcher passes, runs `wcat …`.
 * - Any other start makes sure the `wcat` launcher in the tool's bin folder works: a few `stat` calls when it does.
 */
export const wcatStart = async (tool: WcatTool, io: Partial<WcatStartIo> = {}): Promise<WcatStart> => {
  const argv = io.argv ?? process.argv
  const env = io.env ?? process.env
  const platform = io.platform ?? process.platform
  const stdout = io.stdout ?? process.stdout
  const [first, ...rest] = argv.slice(2)
  if (first === DESCRIBE_FLAG) {
    stdout.write(`${JSON.stringify(describeAnswer(tool, shippedManifest(argv[1])))}\n`)
    return { code: 0 }
  }
  if (first === DISPATCH_FLAG) {
    const { runWcat } = await import("./dispatch.js")
    const code = await runWcat(rest, { env, platform, stdout, stderr: io.stderr ?? process.stderr, self: tool })
    return { code }
  }
  const folder = binFolder({
    name: tool.command,
    argv1: argv[1],
    script: io.script ?? fileURLToPath(import.meta.url),
    env,
    platform,
  })
  return folder ? { launcher: ensureLauncher({ ...folder, platform }) } : {}
}

/**
 * `contracts/wirecat.json` beside the `package.json` nearest the bin, read as shipped and never rebuilt, so the hash
 * Desktop compares is of the very bytes it reviewed. Anything unreadable answers format 1.
 */
const shippedManifest = (bin: string | undefined): ShippedManifest | undefined => {
  if (!bin) return undefined
  try {
    for (let dir = dirname(realpathSync(bin)); ; dir = dirname(dir)) {
      if (existsSync(join(dir, "package.json"))) {
        const bytes = readFileSync(join(dir, "contracts", "wirecat.json"))
        const { wcat_manifest: format, desktop } = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>
        if (format !== 2 || typeof desktop !== "object" || desktop === null) return undefined
        return { desktop, sha256: createHash("sha256").update(bytes).digest("hex") }
      }
      if (dirname(dir) === dir) return undefined
    }
  } catch {
    return undefined
  }
}
