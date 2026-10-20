import { createRequire } from "node:module"

/**
 * The one seam through which the OS keychain is reached.
 *
 * **What backs it, per platform** — `@napi-rs/keyring` 2.1.0, checked 2026-09-19:
 * macOS uses the Keychain and Windows the Credential Manager, both part of the OS; Linux and the
 * BSDs use the Secret Service over D-Bus, which a headless machine, a container, WSL or a CI
 * runner usually does not have. There is nothing to install either way — the package ships
 * prebuilt binaries for twelve platform triples including musl, so no Rust toolchain and no
 * node-gyp — but on Linux **the daemon may simply not be there**, which is why every caller must
 * handle this throwing. `Credentials` does, by warning once and writing a 0600 file instead.
 * Injected like `fetch` in core, so
 * "no test touched the developer's real keychain" is a property of the code rather than a hope
 * about every test remembering to opt out.
 */
export interface KeyringStore {
  get(service: string, account: string): string | null
  set(service: string, account: string, secret: string): void
  delete(service: string, account: string): boolean
}

interface Entry {
  getPassword(): string | null
  setPassword(secret: string): void
  deletePassword(): boolean
}

type EntryConstructor = new (
  service: string,
  account: string,
  options?: { linux?: { store?: "secret-service" | "keyutils" } },
) => Entry

// Without a pinned store the binding silently falls back to the kernel keyring when the Secret
// Service fails (locked, not running): reads miss every stored secret and writes are lost on
// reboot, and nothing throws, so `Credentials` never falls back to its file. Ignored off Linux.
const ENTRY_OPTIONS = { linux: { store: "secret-service" } } as const

const require = createRequire(import.meta.url)
let cached: EntryConstructor | undefined

// Loaded on first use, not at import: `@napi-rs/keyring` is a native module, and a machine
// where its binary is missing must still be able to run in file mode.
const entryClass = (): EntryConstructor => {
  cached ??= (require("@napi-rs/keyring") as { Entry: EntryConstructor }).Entry
  return cached
}

const entry = (service: string, account: string): Entry => new (entryClass())(service, account, ENTRY_OPTIONS)

export const systemKeyring: KeyringStore = {
  // Returns null for an absent entry rather than throwing — measured against @napi-rs/keyring
  // on 2026-09-13, and the difference matters: a throw here means the keychain is unusable.
  get: (service, account) => entry(service, account).getPassword(),
  set: (service, account, secret) => {
    entry(service, account).setPassword(secret)
  },
  delete: (service, account) => entry(service, account).deletePassword(),
}

/** An in-memory stand-in. Every test uses this; none can reach the real keychain. */
export const memoryKeyring = (
  initial: Record<string, string> = {},
): KeyringStore & { entries: Map<string, string> } => {
  const entries = new Map(Object.entries(initial))
  const key = (service: string, account: string) => `${service}:${account}`

  return {
    entries,
    get: (service, account) => entries.get(key(service, account)) ?? null,
    set: (service, account, secret) => {
      entries.set(key(service, account), secret)
    },
    delete: (service, account) => entries.delete(key(service, account)),
  }
}

/** Refuses every operation, so the fallback path can be tested. */
export const brokenKeyring = (message = "no secret service available"): KeyringStore => ({
  get: () => {
    throw new Error(message)
  },
  set: () => {
    throw new Error(message)
  },
  delete: () => {
    throw new Error(message)
  },
})
