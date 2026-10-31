import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Credentials, keyringService, movedRunService } from "./credentials.js"
import { CliError } from "./errors.js"
import { brokenKeyring, memoryKeyring, systemKeyring } from "./keyring.js"

const dir = () => mkdtempSync(join(tmpdir(), "cli-base-creds-"))
const make = (options: Partial<ConstructorParameters<typeof Credentials>[0]> = {}) =>
  new Credentials({
    configDir: dir(),
    service: "max-cli",
    keyring: memoryKeyring(),
    env: {},
    warn: () => {},
    ...options,
  })

describe("Credentials", () => {
  it("prefers the environment over everything else", () => {
    const keyring = memoryKeyring()
    const credentials = make({ keyring, envVar: "MAX_TOKEN", env: { MAX_TOKEN: "from-env" } })
    keyring.set("max-cli", "default", "from-keyring")

    expect(credentials.read("default")).toEqual({ secret: "from-env", source: "environment" })
  })

  it("writes to the keyring and reads it back", () => {
    const credentials = make()
    expect(credentials.write("default", "s3cret")).toBe("keyring")
    expect(credentials.read("default")).toEqual({ secret: "s3cret", source: "keyring" })
  })

  it("falls back to a file when the keyring refuses, and warns exactly once", () => {
    const warnings: string[] = []
    const configDir = dir()
    const credentials = new Credentials({
      configDir,
      service: "max-cli",
      keyring: brokenKeyring(),
      env: {},
      warn: (message) => warnings.push(message),
    })

    expect(credentials.write("default", "s3cret")).toBe("file")
    expect(credentials.read("default")).toEqual({ secret: "s3cret", source: "file" })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/could not reach the OS keyring — it may be locked/)
  })

  it("writes the fallback file with owner-only permissions", () => {
    const configDir = dir()
    new Credentials({ configDir, service: "max-cli", storage: "file", env: {}, warn: () => {} }).write("default", "s")
    expect(statSync(join(configDir, "credentials.json")).mode & 0o777).toBe(0o600)
  })

  it("lets a keyring failure through when the caller demanded the keyring", () => {
    const credentials = make({ keyring: brokenKeyring(), storage: "keyring" })
    expect(() => credentials.write("default", "s")).toThrow(/no secret service/)
  })

  it("removes from both places and says which ones held something", () => {
    const configDir = dir()
    const keyring = memoryKeyring()
    const credentials = new Credentials({ configDir, service: "max-cli", keyring, env: {}, warn: () => {} })
    credentials.write("default", "in-keyring")

    expect(credentials.remove("default")).toEqual(["keyring"])
    expect(credentials.read("default")).toBeUndefined()
  })

  it("keeps two accounts apart", () => {
    const credentials = make()
    credentials.write("default", "one")
    credentials.write("personal", "two")
    expect(credentials.read("personal")?.secret).toBe("two")
  })

  it("never writes the secret anywhere the file store does not name", () => {
    const configDir = dir()
    new Credentials({ configDir, service: "max-cli", storage: "file", env: {}, warn: () => {} }).write(
      "default",
      "s3cret",
    )
    const written = readFileSync(join(configDir, "credentials.json"), "utf8")
    expect(JSON.parse(written)).toEqual({ default: { secret: "s3cret" } })
  })
})

describe("a run with moved folders and the system keyring", () => {
  afterEach(() => vi.restoreAllMocks())

  const ownerHome = userInfo().homedir
  const stubSystemKeyring = (saved: Record<string, string> = {}) => ({
    get: vi
      .spyOn(systemKeyring, "get")
      .mockImplementation((service, account) => saved[`${service}/${account}`] ?? null),
    set: vi.spyOn(systemKeyring, "set").mockImplementation((service, account, secret) => {
      saved[`${service}/${account}`] = secret
    }),
    delete: vi.spyOn(systemKeyring, "delete").mockImplementation((service, account) => {
      const existed = `${service}/${account}` in saved
      delete saved[`${service}/${account}`]
      return existed
    }),
  })

  const moved = {
    "a <PREFIX>_CONFIG_DIR override": { isolated: true, env: { HOME: ownerHome } },
    "a throwaway HOME": { env: { HOME: "/tmp/x" } },
    "a moved XDG_CONFIG_HOME": { env: { HOME: ownerHome, XDG_CONFIG_HOME: "/tmp/x/config" } },
  }

  for (const [name, options] of Object.entries(moved)) {
    it(`writes a temporary entry and never replaces the owner's with ${name}`, () => {
      const configDir = dir()
      const keyring = stubSystemKeyring({ "max-cli/default": "owner's" })
      const credentials = make({ configDir, keyring: systemKeyring, ...options })

      expect(credentials.write("default", "throwaway")).toBe("keyring")
      expect(keyring.set).toHaveBeenCalledExactlyOnceWith(movedRunService("max-cli", configDir), "default", "throwaway")
      expect(keyring.set).not.toHaveBeenCalledWith("max-cli", expect.anything(), expect.anything())
    })

    it(`reads the temporary entry first, then the owner's, with ${name}`, () => {
      const configDir = dir()
      stubSystemKeyring({ "max-cli/default": "owner's", "max-cli/work": "owner's work" })
      const credentials = make({ configDir, keyring: systemKeyring, ...options })
      credentials.write("default", "throwaway")

      expect(credentials.read("default")).toEqual({ secret: "throwaway", source: "keyring" })
      expect(credentials.read("work")).toEqual({ secret: "owner's work", source: "keyring" })
    })

    it(`deletes only the temporary entry with ${name}`, () => {
      const configDir = dir()
      const keyring = stubSystemKeyring({ "max-cli/default": "owner's" })
      const warnings: string[] = []
      const credentials = make({
        configDir,
        keyring: systemKeyring,
        warn: (message) => warnings.push(message),
        ...options,
      })

      credentials.write("default", "throwaway")

      expect(credentials.remove("default")).toEqual(["keyring"])
      expect(keyring.delete).toHaveBeenCalledExactlyOnceWith(movedRunService("max-cli", configDir), "default")
      expect(warnings.join()).toMatch(/kept default in the OS keyring/)
      expect(credentials.read("default")).toEqual({ secret: "owner's", source: "keyring" })
    })
  }

  it("says nothing was removed when the run had no temporary entry", () => {
    stubSystemKeyring({ "max-cli/default": "owner's" })

    expect(make({ keyring: systemKeyring, isolated: true }).remove("default")).toEqual([])
  })

  it("still removes a file sign-in, so `session start --credential-storage file` then end works", () => {
    const keyring = stubSystemKeyring({ "max-cli/default": "owner's" })
    const configDir = dir()
    make({ configDir, storage: "file", isolated: true }).write("default", "throwaway")
    const credentials = make({ configDir, keyring: systemKeyring, isolated: true })

    expect(credentials.remove("default")).toEqual(["file"])
    expect(keyring.delete).not.toHaveBeenCalledWith("max-cli", expect.anything())
  })

  it("writes, reads and deletes the owner's entry when the folders are the owner's own", () => {
    const keyring = stubSystemKeyring({ "max-cli/default": "owner's" })
    const credentials = make({ keyring: systemKeyring, env: { HOME: ownerHome } })

    expect(credentials.read("default")).toEqual({ secret: "owner's", source: "keyring" })
    credentials.write("default", "renewed")
    expect(keyring.set).toHaveBeenCalledExactlyOnceWith("max-cli", "default", "renewed")
    expect(credentials.remove("default")).toEqual(["keyring"])
    expect(keyring.delete).toHaveBeenCalledExactlyOnceWith("max-cli", "default")
  })
})

describe("a credentials file that cannot be parsed", () => {
  const broken = '{"other":{"secret":"keep-me"'

  for (const content of [broken, "null", "[]"]) {
    it(`refuses to write over ${JSON.stringify(content)} and leaves it as it was`, () => {
      const configDir = dir()
      const path = join(configDir, "credentials.json")
      writeFileSync(path, content)
      const credentials = make({ configDir, keyring: brokenKeyring() })

      const error = (() => {
        try {
          credentials.write("default", "s3cret")
        } catch (caught) {
          return caught
        }
      })()
      expect(error).toBeInstanceOf(CliError)
      expect((error as CliError).code).toBe("configuration_error")
      expect((error as CliError).message).toContain(path)
      expect((error as CliError).message).not.toContain("keep-me")
      expect(readFileSync(path, "utf8")).toBe(content)
      expect(credentials.read("default")).toBeUndefined()
    })
  }

  it("removes nothing from it", () => {
    const configDir = dir()
    writeFileSync(join(configDir, "credentials.json"), broken)
    expect(make({ configDir, storage: "file" }).remove("other")).toEqual([])
    expect(readFileSync(join(configDir, "credentials.json"), "utf8")).toBe(broken)
  })
})

describe("movedRunService", () => {
  it("names the temporary entry by the absolute config folder", () => {
    expect(movedRunService("max-cli", "/tmp/x/../y")).toBe("max-cli:/tmp/y")
  })
})

describe("keyringService", () => {
  it("names the app's own entry for a moved run too", () => {
    expect(keyringService("max-cli", "/tmp/x", true)).toBe("max-cli")
    expect(keyringService("max-cli", "/home/me/.config/max-cli", false)).toBe("max-cli")
  })
})
