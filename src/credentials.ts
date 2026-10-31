import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { writeSecurely } from "./config.js"
import { CliError } from "./errors.js"
import { type KeyringStore, systemKeyring } from "./keyring.js"
import { homeIsMoved } from "./paths.js"

export const CREDENTIAL_STORAGE = ["auto", "keyring", "file"] as const
export type CredentialStorage = (typeof CREDENTIAL_STORAGE)[number]

export type CredentialSource = "environment" | "keyring" | "file"

export interface StoredCredential {
  secret: string
  source: CredentialSource
}

export interface CredentialsOptions {
  /** Where the fallback file lives when the keyring cannot be used. */
  configDir: string
  /** The keyring service name — the CLI's app name, e.g. `max-cli`, not its command word. */
  service: string
  /**
   * **True when the run's folders are not the owner's own** — pass `isMovedRun(…)`.
   *
   * With the system keyring the run reads the owner's entry (`service`) but never replaces or deletes it: `write`
   * goes to a temporary entry, `movedRunService(service, configDir)`, which `read` prefers and `remove` deletes
   * (WC-SECR-24). A moved `HOME` or XDG folder in `env` counts as moved even when this is false.
   */
  isolated?: boolean
  /** Read before the keyring, for CI. */
  envVar?: string
  storage?: CredentialStorage
  keyring?: KeyringStore
  env?: NodeJS.ProcessEnv
  fileName?: string
  /** Where the one-line warning goes when the keyring is unavailable. Never stdout. */
  warn?: (message: string) => void
}

/**
 * The app's shared keyring service, which a moved run reads too. The other two arguments are ignored and stay only so
 * that callers written against 0.65.0 still compile.
 */
export const keyringService = (service: string, _configDir?: string, _isolated?: boolean): string => service

/**
 * The temporary keyring service a moved run writes instead of the owner's entry: `<app>:<absolute config folder>`, the
 * shape `bin/keyring-dedupe` already finds and removes.
 */
export const movedRunService = (service: string, configDir: string): string => `${service}:${resolve(configDir)}`

type FileStore = Record<string, { secret?: string }>

/**
 * Environment first, then the OS keyring, then a file.
 *
 * `auto` does not probe whether a keyring exists: it attempts the operation, and on failure warns
 * once and falls through. A probe would touch the user's keychain for nothing and could still
 * succeed where the real operation fails.
 */
export class Credentials {
  readonly #configDir: string
  readonly #storage: CredentialStorage
  readonly #keyring: KeyringStore
  readonly #env: NodeJS.ProcessEnv
  readonly #service: string
  readonly #envVar: string | undefined
  readonly #fileName: string
  readonly #warn: (message: string) => void
  /** Set only for a moved run with the system keyring. */
  readonly #temporaryService: string | undefined
  #warned = false

  constructor(options: CredentialsOptions) {
    this.#configDir = options.configDir
    this.#storage = options.storage ?? "auto"
    this.#keyring = options.keyring ?? systemKeyring
    this.#env = options.env ?? process.env
    this.#envVar = options.envVar
    this.#fileName = options.fileName ?? "credentials.json"
    this.#warn = options.warn ?? ((message) => process.stderr.write(`${message}\n`))
    this.#service = options.service
    const moved = this.#keyring === systemKeyring && (options.isolated === true || homeIsMoved({ env: this.#env }))
    this.#temporaryService = moved ? movedRunService(options.service, options.configDir) : undefined
  }

  read(account: string): StoredCredential | undefined {
    const fromEnv = this.#envVar ? this.#env[this.#envVar]?.trim() : undefined
    if (fromEnv) return { secret: fromEnv, source: "environment" }

    if (this.#storage !== "file") {
      const temporary = this.#temporaryService
      const fromKeyring = this.#tryKeyring(
        () => (temporary && this.#keyring.get(temporary, account)) || this.#keyring.get(this.#service, account),
      )
      if (fromKeyring) return { secret: fromKeyring, source: "keyring" }
    }

    const secret = this.#readFile()?.[account]?.secret
    return secret ? { secret, source: "file" } : undefined
  }

  write(account: string, secret: string): CredentialSource {
    if (this.#storage !== "file") {
      const stored = this.#tryKeyring(() => {
        this.#keyring.set(this.#temporaryService ?? this.#service, account, secret)
        return true
      })
      if (stored) return "keyring"
    }

    const store = this.#readFile()
    if (!store) {
      throw new CliError(
        "configuration_error",
        `${this.#path()} cannot be read as a credentials file; storing now would replace every secret in it. ` +
          "Fix the file or move it aside, then try again.",
      )
    }
    store[account] = { secret }
    this.#writeFile(store)
    return "file"
  }

  remove(account: string): CredentialSource[] {
    const removed: CredentialSource[] = []

    if (this.#storage !== "file") {
      if (this.#tryKeyring(() => this.#keyring.delete(this.#temporaryService ?? this.#service, account))) {
        removed.push("keyring")
      }
      if (this.#temporaryService && this.#ownersEntryExists(account)) {
        this.#warn(
          removed.includes("keyring")
            ? `removed this run's own sign-in of ${account} from the OS keyring and kept the owner's: a run with ` +
                "moved folders never removes it"
            : `kept ${account} in the OS keyring: it is the owner's sign-in, shared with every run, and a run with ` +
                "moved folders never removes it",
        )
      }
    }

    const store = this.#readFile()
    if (store?.[account] !== undefined) {
      delete store[account]
      this.#writeFile(store)
      removed.push("file")
    }

    return removed
  }

  /** Only for the warning: a keyring that fails here must not fail a removal that already happened. */
  #ownersEntryExists(account: string): boolean {
    try {
      return this.#keyring.get(this.#service, account) !== null
    } catch {
      return false
    }
  }

  #path(): string {
    return join(this.#configDir, this.#fileName)
  }

  /** `undefined` when the file exists but is not a store: writing would replace what it holds. */
  #readFile(): FileStore | undefined {
    let text: string
    try {
      text = readFileSync(this.#path(), "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
      return undefined
    }
    try {
      const parsed: unknown = JSON.parse(text)
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as FileStore) : undefined
    } catch {
      // The parser's message quotes the file, and the file holds secrets.
      return undefined
    }
  }

  #writeFile(store: FileStore): void {
    writeSecurely(this.#path(), `${JSON.stringify(store, null, 2)}\n`, 0o600)
  }

  #tryKeyring<T>(operation: () => T): T | undefined {
    if (this.#storage === "keyring") return operation()

    try {
      return operation()
    } catch (error) {
      if (!this.#warned) {
        this.#warned = true
        this.#warn(
          `could not reach the OS keyring — it may be locked, or no keyring service is running ` +
            `(${error instanceof Error ? error.message : String(error)}); ` +
            `using ${this.#path()} instead, readable only by you`,
        )
      }
      return undefined
    }
  }
}
