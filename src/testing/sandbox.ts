import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface Sandbox {
  dir: string
  /** Puts every variable back as it was and removes the directory. */
  restore(): void
}

const OVERRIDE = /_(CONFIG|STATE|CACHE)_DIR$/

// macOS keeps a Unix socket path under 104 bytes, and its per-user temporary folder alone takes about 50.
const baseFor = (platform: NodeJS.Platform): string => (platform === "darwin" ? "/tmp" : tmpdir())

const LEFT = Symbol.for("@wirecat/cli-base/testing/sandboxes")

/**
 * vitest skips a file's afterAll when the file throws while loading or an earlier afterAll throws,
 * and then ends the worker with SIGTERM, which fires no `exit`. The signal is raised again once the
 * folders are gone, so the worker still ends the way it would have.
 */
const removeOnExit = (dir: string): (() => void) => {
  const holder = globalThis as { [LEFT]?: Set<string> }
  if (!holder[LEFT]) {
    const left = new Set<string>()
    holder[LEFT] = left
    const removeLeft = () => {
      for (const path of left) rmSync(path, { recursive: true, force: true })
      left.clear()
    }
    process.once("exit", removeLeft)
    process.once("SIGTERM", () => {
      removeLeft()
      process.kill(process.pid, "SIGTERM")
    })
  }
  const left = holder[LEFT]
  left.add(dir)
  return () => left.delete(dir)
}

/**
 * Points everything a test could write to at a fresh directory: the temporary folder, the home
 * folder and its XDG and Windows folders, and every `<APP>_CONFIG_DIR`, `_STATE_DIR` and
 * `_CACHE_DIR` already set. One that is not set falls back to the sandboxed home, so a CLI needs no
 * list of its own prefixes; one set in the developer's shell would otherwise point at the real one.
 * npm's and pnpm's update check is off: with a fresh home it would reach the registry from a child
 * process, past the network guard, and print its notice into output the test parses.
 */
export const enterSandbox = (
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Sandbox => {
  const dir = mkdtempSync(join(baseFor(platform), "wirecat-test-"))
  const forget = removeOnExit(dir)
  const home = join(dir, "home")
  mkdirSync(home)

  const wanted: Record<string, string> = {
    TMPDIR: dir,
    TMP: dir,
    TEMP: dir,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    npm_config_update_notifier: "false",
    NO_UPDATE_NOTIFIER: "1",
  }
  for (const key of Object.keys(env))
    if (OVERRIDE.test(key) || key === "MESSAGING_STORE") wanted[key] = join(dir, "env", key)

  const previous = Object.keys(wanted).map((key) => [key, env[key]] as const)
  Object.assign(env, wanted)

  return {
    dir,
    restore: () => {
      for (const [key, value] of previous) {
        if (value === undefined) delete env[key]
        else env[key] = value
      }
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      forget()
    },
  }
}

export const REAL_KEYRING_REACHED = "a test reached the real OS keyring — pass memoryKeyring() instead"

class ThrowingEntry {
  constructor() {
    throw new Error(REAL_KEYRING_REACHED)
  }
}

/**
 * `systemKeyring` loads `@napi-rs/keyring` through `createRequire`, which `vi.mock` does not
 * intercept, so the stand-in goes into the CommonJS require cache. Resolved from here (the copy
 * `keyring.ts` loads) and from the working directory (a CLI's own copy). Never removed.
 */
export const installThrowingKeyring = (): void => {
  const resolvers = [createRequire(import.meta.url), createRequire(join(process.cwd(), "package.json"))]
  for (const require of resolvers) {
    let path: string
    try {
      path = require.resolve("@napi-rs/keyring")
    } catch {
      continue
    }
    require.cache[path] = {
      id: path,
      filename: path,
      loaded: true,
      exports: { Entry: ThrowingEntry },
    } as unknown as NodeJS.Module
  }
}
