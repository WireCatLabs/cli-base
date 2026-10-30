import { homedir, userInfo } from "node:os"
import { join, posix, win32 } from "node:path"

export interface Paths {
  /** `config.json`, and the credential file when the keyring is unavailable. */
  config: string
  /** Everything the program writes for itself: sessions, run artifacts, databases. */
  state: string
  /** Data that can be deleted without losing anything the user typed. */
  cache: string
}

export interface PathsOptions {
  /** Directory name under the OS convention — the command's name, not the package's. */
  appName: string
  /**
   * Environment variable prefix for the overrides, e.g. `MAX` gives `MAX_CONFIG_DIR`.
   * Defaults to the app name, upper-cased, with anything that is not a letter or digit as `_`.
   */
  prefix?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

export const PATH_KINDS = ["config", "state", "cache"] as const
const OVERRIDES = { config: "CONFIG_DIR", state: "STATE_DIR", cache: "CACHE_DIR" } as const

const overrideName = (appName: string, prefix: string | undefined, kind: keyof Paths) =>
  `${prefix ?? appName.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${OVERRIDES[kind]}`

/**
 * The XDG layout on macOS too: a CLI user expects `~/.config`, and one layout is one set of docs.
 * Windows keeps the layout `env-paths` gave it, so nothing there moves. Everything is read from
 * `env`, never the global one, so a test can point every directory at a temp folder.
 */
export const defaultPaths = ({ appName, env = process.env, platform = process.platform }: PathsOptions): Paths => {
  if (platform === "win32") {
    const home = env.USERPROFILE || homedir()
    const roaming = env.APPDATA || win32.join(home, "AppData", "Roaming")
    const local = env.LOCALAPPDATA || win32.join(home, "AppData", "Local")
    return {
      config: win32.join(roaming, appName, "Config"),
      state: win32.join(local, appName, "Data"),
      cache: win32.join(local, appName, "Cache"),
    }
  }
  const home = env.HOME || homedir()
  return {
    config: posix.join(env.XDG_CONFIG_HOME || posix.join(home, ".config"), appName),
    state: posix.join(env.XDG_DATA_HOME || posix.join(home, ".local", "share"), appName),
    cache: posix.join(env.XDG_CACHE_HOME || posix.join(home, ".cache"), appName),
  }
}

/**
 * Each directory is overridable by environment variable, which is what makes a test — and a
 * throwaway profile — possible without touching the real ones.
 */
export const resolvePaths = (options: PathsOptions): Paths => {
  const { appName, prefix, env = process.env } = options
  const base = defaultPaths(options)
  return {
    config: env[overrideName(appName, prefix, "config")] ?? base.config,
    state: env[overrideName(appName, prefix, "state")] ?? base.state,
    cache: env[overrideName(appName, prefix, "cache")] ?? base.cache,
  }
}

/** Whether any of the three directories came from the environment rather than the OS convention. */
export const pathsAreOverridden = ({ appName, prefix, env = process.env }: PathsOptions): boolean =>
  PATH_KINDS.some((kind) => env[overrideName(appName, prefix, kind)] !== undefined)

const accountHome = (): string | undefined => {
  try {
    return userInfo().homedir
  } catch {
    return undefined
  }
}

/**
 * Whether `HOME` or an XDG (or Windows) folder in `env` puts the default folders anywhere but under the account's own
 * home, which comes from the user database: `os.homedir()` returns `$HOME` and would miss exactly this. An account with
 * no home entry counts as moved.
 */
export const homeIsMoved = ({
  env = process.env,
  platform = process.platform,
  home = accountHome(),
}: {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  home?: string | undefined
} = {}): boolean => {
  if (home === undefined) return true
  const appName = "app"
  const actual = defaultPaths({ appName, env, platform })
  const owners = defaultPaths({ appName, env: { HOME: home, USERPROFILE: home }, platform })
  return PATH_KINDS.some((kind) => actual[kind] !== owners[kind])
}

/**
 * **A run whose folders are not the owner's own**: a `<PREFIX>_*_DIR` override, or a moved `HOME` or XDG folder.
 * It still shares the owner's keyring entry, so it must not delete or revoke it (WC-SECR-24).
 */
export const isMovedRun = (options: PathsOptions & { home?: string | undefined }): boolean =>
  pathsAreOverridden(options) || homeIsMoved(options)

export const configFilePath = (configDir: string, fileName = "config.json"): string => join(configDir, fileName)
