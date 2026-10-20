import { mkdtempSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { brokenKeyring, memoryKeyring, systemKeyring } from "./keyring.js"

describe("memoryKeyring", () => {
  it("stores, reads and deletes per service and account", () => {
    const keyring = memoryKeyring()

    keyring.set("max-cli", "default", "secret-a")
    keyring.set("max-cli", "personal", "secret-b")

    expect(keyring.get("max-cli", "default")).toBe("secret-a")
    expect(keyring.get("max-cli", "personal")).toBe("secret-b")
    expect(keyring.delete("max-cli", "default")).toBe(true)
    expect(keyring.get("max-cli", "default")).toBeNull()
  })

  it("answers null for an entry that was never written, rather than throwing", () => {
    expect(memoryKeyring().get("max-cli", "absent")).toBeNull()
  })

  it("keeps two services apart under the same account name", () => {
    const keyring = memoryKeyring()
    keyring.set("max-cli", "default", "one")
    keyring.set("other-cli", "default", "two")
    expect(keyring.get("max-cli", "default")).toBe("one")
  })
})

describe("brokenKeyring", () => {
  it("refuses every operation, so the file fallback has something to be tested against", () => {
    const keyring = brokenKeyring()
    expect(() => keyring.get("max-cli", "default")).toThrow(/no secret service/)
    expect(() => keyring.set("max-cli", "default", "x")).toThrow()
    expect(() => keyring.delete("max-cli", "default")).toThrow()
  })
})

describe("systemKeyring", () => {
  it("cannot reach the real keychain from a test", () => {
    expect(() => systemKeyring.get("cli-base-test", "default")).toThrow(/real OS keyring/)
    expect(() => systemKeyring.set("cli-base-test", "default", "x")).toThrow(/real OS keyring/)
    expect(() => systemKeyring.delete("cli-base-test", "default")).toThrow(/real OS keyring/)
  })
})

describe("systemKeyring with the binding replaced", () => {
  const require = createRequire(import.meta.url)
  const path = require.resolve("@napi-rs/keyring")
  const guard = require.cache[path]

  afterEach(() => {
    require.cache[path] = guard
  })

  const withBinding = async (Entry: unknown) => {
    require.cache[path] = { ...guard, exports: { Entry } } as NodeJS.Module
    vi.resetModules()
    return import("./keyring.js")
  }

  it("pins every entry to the Secret Service, so a locked keyring throws instead of using kernel memory", async () => {
    const seen: unknown[] = []
    class RecordingEntry {
      constructor(_service: string, _account: string, options: unknown) {
        seen.push(options)
      }
      getPassword = () => null
      setPassword = () => {}
      deletePassword = () => false
    }
    const { systemKeyring: keyring } = await withBinding(RecordingEntry)

    expect(keyring.get("cli-base-test", "default")).toBeNull()
    keyring.set("cli-base-test", "default", "x")
    keyring.delete("cli-base-test", "default")

    expect(seen).toEqual(Array(3).fill({ linux: { store: "secret-service" } }))
  })

  it("lets Credentials warn and use its file when the pinned Secret Service does not answer", async () => {
    class LockedEntry {
      constructor() {
        throw new Error("DBus error: Did not receive a reply")
      }
    }
    const { systemKeyring: keyring } = await withBinding(LockedEntry)
    const { Credentials } = await import("./credentials.js")
    const warnings: string[] = []
    const credentials = new Credentials({
      configDir: mkdtempSync(join(tmpdir(), "cli-base-keyring-")),
      service: "cli-base-test",
      keyring,
      env: {},
      warn: (message) => warnings.push(message),
    })

    expect(credentials.write("default", "s3cret")).toBe("file")
    expect(credentials.read("default")).toEqual({ secret: "s3cret", source: "file" })
    expect(warnings).toEqual([expect.stringMatching(/could not reach the OS keyring .*Did not receive a reply/)])
  })
})
