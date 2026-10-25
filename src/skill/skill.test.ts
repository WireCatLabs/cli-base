import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { Command } from "commander"
import { beforeEach, describe, expect, it } from "vitest"
import { parse } from "yaml"
import { metaOf } from "../commands/index.js"
import { CliError } from "../errors.js"
import { createRenderer } from "../renderer.js"
import { captureStreams, fakeClock } from "../testing/index.js"
import { readUpdateState, writeUpdateState } from "../update/index.js"
import {
  hermesCopyPath,
  hermesSkillStatus,
  skillCommand,
  skillHint,
  skillPath,
  skillResource,
  skillVersion,
  withVersion,
} from "./index.js"

const SKILL = "---\nname: tg-cli\ndescription: Read Telegram.\n---\n\n# tg\n\nBody.\n"
const app = { command: "tg", appName: "tg-cli", version: "1.2.0" }

let dir: string
let env: Record<string, string>
let skill: URL

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "skill-"))
  mkdirSync(join(dir, "bin"))
  env = { HOME: join(dir, "home"), HERMES_HOME: join(dir, "hermes"), PATH: join(dir, "bin") }
  writeFileSync(join(dir, "SKILL.md"), SKILL)
  skill = pathToFileURL(join(dir, "SKILL.md"))
})

const run = async (args: string[], more: Record<string, URL> = {}) => {
  const streams = captureStreams()
  const json = args.includes("--json")
  const program = new Command().option("--json").exitOverride()
  program.addCommand(
    skillCommand(
      app,
      skill,
      () => ({
        renderer: createRenderer({ format: json ? "json" : "pretty", color: false, streams }),
        streams,
        env,
      }),
      more,
    ),
  )
  await program.parseAsync(args, { from: "user" })
  return streams
}

describe("withVersion", () => {
  it("adds metadata.version as a string and leaves every other byte alone", () => {
    expect(withVersion(SKILL, "1.2.0")).toBe(
      '---\nname: tg-cli\ndescription: Read Telegram.\nmetadata:\n  version: "1.2.0"\n---\n\n# tg\n\nBody.\n',
    )
  })

  it("replaces a version already there", () => {
    const stamped = withVersion(withVersion(SKILL, "1.0.0"), "1.2.0")
    expect(stamped).toBe(withVersion(SKILL, "1.2.0"))
    expect(skillVersion(stamped)).toBe("1.2.0")
  })

  it("keeps the other metadata and its indentation", () => {
    const own = "---\nname: tg-cli\nmetadata:\n    author: a\nlicense: MIT\n---\n# tg\n"
    expect(withVersion(own, "1.2.0")).toBe(
      '---\nname: tg-cli\nmetadata:\n    version: "1.2.0"\n    author: a\nlicense: MIT\n---\n# tg\n',
    )
  })

  it("keeps Windows line endings", () => {
    const crlf = SKILL.replaceAll("\n", "\r\n")
    expect(withVersion(crlf, "1.2.0")).toBe(withVersion(SKILL, "1.2.0").replaceAll("\n", "\r\n"))
    expect(skillVersion(withVersion(withVersion(crlf, "1.0.0"), "1.2.0"))).toBe("1.2.0")
  })

  it("gives a file with no frontmatter one", () => {
    expect(withVersion("# tg\n", "1.2.0")).toBe('---\nmetadata:\n  version: "1.2.0"\n---\n# tg\n')
    expect(skillVersion("# tg\n")).toBeUndefined()
  })

  it("keeps a nested metadata.openclaw block whole, as YAML reads it", () => {
    const own = [
      "---",
      "name: tg-cli",
      "metadata:",
      "  openclaw:",
      "    requires:",
      "      bins: [tg]",
      "    install:",
      "      - kind: node",
      '        package: "@wirecat/tg-cli"',
      "        bins: [tg]",
      "---",
      "# tg",
      "",
    ].join("\n")
    const stamped = withVersion(withVersion(own, "1.0.0"), "1.2.0")
    expect(skillVersion(stamped)).toBe("1.2.0")
    expect(parse(stamped.split("---")[1] as string)).toEqual({
      name: "tg-cli",
      metadata: {
        version: "1.2.0",
        openclaw: { requires: { bins: ["tg"] }, install: [{ kind: "node", package: "@wirecat/tg-cli", bins: ["tg"] }] },
      },
    })
  })

  it("refuses metadata written on one line", () => {
    expect(() => withVersion("---\nmetadata: {a: b}\n---\n", "1.2.0")).toThrow(CliError)
  })
})

describe("skillVersion", () => {
  it("still reads the top-level version a pre-release build wrote", () => {
    expect(skillVersion("---\nname: tg-cli\nversion: 1.1.0\n---\n")).toBe("1.1.0")
  })
})

describe("skill effects", () => {
  it("reads the machine to show and to report status, writes it to install, and never touches the service", () => {
    const command = skillCommand(app, skill, () => {
      throw new Error("not run")
    })
    const effects = Object.fromEntries(command.commands.map((sub) => [sub.name(), metaOf(sub).effects]))
    expect(effects).toEqual({
      show: { remote: "none", local: "read" },
      install: { remote: "none", local: "write" },
      status: { remote: "none", local: "read" },
    })
  })
})

describe("skill show", () => {
  it("prints SKILL.md itself on stdout, even with nobody at a terminal", async () => {
    const { stdout, stderr } = await run(["skill", "show"])
    expect(stdout).toEqual([SKILL.trimEnd()])
    expect(stderr).toEqual([])
  })

  it("answers JSON when asked for it", async () => {
    const { stdout } = await run(["--json", "skill", "show"])
    expect(JSON.parse(stdout.join(""))).toEqual({ name: "tg-cli", content: SKILL.trimEnd() })
  })

  it("**prints a skill a library ships by name**, with this CLI's command in it, and refuses an unknown name", async () => {
    writeFileSync(
      join(dir, "link.md"),
      "---\nname: link-conversations\n---\n\nRun `{{command}} conversations batches next`.\n",
    )
    const more = { "link-conversations": pathToFileURL(join(dir, "link.md")) }

    const { stdout } = await run(["skill", "show", "link-conversations"], more)
    expect(stdout.join("")).toContain("Run `tg conversations batches next`.")
    expect((await run(["skill", "show"], more)).stdout).toEqual([SKILL.trimEnd()])
    await expect(run(["skill", "show", "nope"], more)).rejects.toThrow(
      'no skill "nope" — there are: link-conversations',
    )
    await expect(run(["skill", "show", "nope"])).rejects.toThrow()
  })
})

describe("skill show --for", () => {
  const install = (target: "claude" | "agents", content: string) => {
    const path = skillPath(target, "tg-cli", env)
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, content)
    return path
  }

  it("prints the copy installed for one agent, not this version's, so a host can show what an update changes", async () => {
    const old = withVersion(SKILL.replace("Body.", "Old body."), "1.1.0")
    const path = install("claude", old)

    expect((await run(["skill", "show", "--for", "claude"])).stdout).toEqual([old.trimEnd()])
    expect(JSON.parse((await run(["--json", "skill", "show", "--for", "claude"])).stdout.join(""))).toEqual({
      name: "tg-cli",
      target: "claude",
      path,
      installed: "1.1.0",
      content: old.trimEnd(),
    })
  })

  it("says how to install when the agent has no copy, and writes nothing", async () => {
    install("claude", SKILL)
    await expect(run(["skill", "show", "--for", "agents"])).rejects.toThrow("skill install --for agents")
    expect(() => readFileSync(skillPath("agents", "tg-cli", env))).toThrow()
  })

  it("refuses a shipped skill by name, which is never installed", async () => {
    const more = { "link-conversations": pathToFileURL(join(dir, "SKILL.md")) }
    await expect(run(["skill", "show", "link-conversations", "--for", "claude"], more)).rejects.toThrow(
      "only tg-cli is installed",
    )
  })
})

describe("skill install", () => {
  const claude = () => skillPath("claude", "tg-cli", env)
  const agents = () => skillPath("agents", "tg-cli", env)

  it("writes the stamped skill for both agents under HOME, and says so on stderr", async () => {
    expect(claude().startsWith(dir)).toBe(true)
    const { stdout, stderr } = await run(["--json", "skill", "install"])

    expect(JSON.parse(stdout.join(""))).toEqual({ name: "tg-cli", version: "1.2.0", written: [claude(), agents()] })
    expect(stderr).toHaveLength(1)
    expect(readFileSync(claude(), "utf8")).toBe(withVersion(SKILL, "1.2.0"))
    expect(readFileSync(agents(), "utf8")).toBe(withVersion(SKILL, "1.2.0"))
  })

  it("gives the same files when run again", async () => {
    await run(["skill", "install"])
    await run(["skill", "install"])
    expect(readFileSync(claude(), "utf8")).toBe(withVersion(SKILL, "1.2.0"))
  })

  it("refuses a SKILL.md whose name is not the directory it installs into", async () => {
    writeFileSync(join(dir, "SKILL.md"), SKILL.replace("name: tg-cli", "name: tgcli"))
    await expect(run(["skill", "install"])).rejects.toThrow(/"tgcli".*"tg-cli"/)
    expect(() => readFileSync(claude())).toThrow()
  })

  it("installs for one agent when told which", async () => {
    const { stdout } = await run(["--json", "skill", "install", "--for", "claude"])
    expect(JSON.parse(stdout.join("")).written).toEqual([claude()])
    expect(() => readFileSync(agents())).toThrow()
  })
})

describe.skipIf(process.platform === "win32")("skill install --for hermes", () => {
  const hermesDir = () => join(dir, "hermes")
  const agentsFolder = () => join(env.HOME as string, ".agents", "skills")
  const calls = () =>
    existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8").trim().split("\n") : []
  const listed = () => JSON.parse(readFileSync(join(dir, "dirs.json"), "utf8"))
  // Answers `config get` from dirs.json and writes `config set` to it, with shell builtins alone: PATH is this folder.
  const stubHermes = ({ dirs, failSet = false }: { dirs?: string; failSet?: boolean } = {}) => {
    if (dirs !== undefined) writeFileSync(join(dir, "dirs.json"), dirs)
    const stub = join(dir, "bin", "hermes")
    writeFileSync(
      stub,
      [
        "#!/bin/sh",
        `echo "$*" >> "${join(dir, "calls")}"`,
        'case "$1 $2" in',
        `  "config get") if [ -f "${join(dir, "dirs.json")}" ]; then IFS= read -r line < "${join(dir, "dirs.json")}"; printf '%s' "$line"; else echo "[]"; fi ;;`,
        failSet
          ? '  "config set") exit 1 ;;'
          : `  "config set") printf '%s' "$4" > "${join(dir, "dirs.json")}"; echo "✓ Set $3" ;;`,
        "  *) exit 2 ;;",
        "esac",
      ].join("\n"),
    )
    chmodSync(stub, 0o755)
  }
  const install = async () => {
    const { stdout, stderr } = await run(["--json", "skill", "install", "--for", "hermes"])
    return { result: JSON.parse(stdout.join("")), stderr }
  }

  it("has Hermes read ~/.agents/skills, keeping the folders it already lists, and prints only the result", async () => {
    stubHermes({ dirs: '["/team/skills"]' })
    const { result } = await install()

    expect(result).toEqual({
      name: "tg-cli",
      version: "1.2.0",
      written: [skillPath("agents", "tg-cli", env)],
      hermes: { via: "external_dirs", path: skillPath("agents", "tg-cli", env) },
    })
    expect(listed()).toEqual(["/team/skills", agentsFolder()])
    expect(existsSync(hermesCopyPath("tg-cli", env))).toBe(false)
  })

  it("changes nothing in Hermes when it already lists the folder, however it is written", async () => {
    stubHermes({ dirs: '["~/.agents/skills"]' })
    expect((await install()).result.hermes.via).toBe("external_dirs")
    stubHermes({ dirs: '"$HOME/.agents/skills"' })
    expect((await install()).result.hermes.via).toBe("external_dirs")
    expect(calls().filter((call) => call.startsWith("config set"))).toEqual([])
  })

  it("turns one folder written as a string into a list of two", async () => {
    stubHermes({ dirs: '"/team/skills"' })
    await install()
    expect(listed()).toEqual(["/team/skills", agentsFolder()])
  })

  it("copies the skill into HERMES_HOME when Hermes is not on PATH, and says why", async () => {
    const { result, stderr } = await install()
    const copy = join(hermesDir(), "skills", "tg-cli", "SKILL.md")

    expect(result.written).toEqual([skillPath("agents", "tg-cli", env), copy])
    expect(result.hermes).toEqual({
      via: "copy",
      path: copy,
      reason: "Hermes could not be asked for skills.external_dirs",
    })
    expect(readFileSync(copy, "utf8")).toBe(withVersion(SKILL, "1.2.0"))
    expect(stderr.join("")).toContain("a copy for Hermes")
  })

  it("copies the skill when Hermes refuses the change, and leaves its list as it was", async () => {
    stubHermes({ dirs: '["/team/skills"]', failSet: true })
    expect((await install()).result.hermes).toMatchObject({ via: "copy", reason: "hermes config set failed" })
    expect(listed()).toEqual(["/team/skills"])
  })

  it("never overwrites a setting that is neither a list nor one folder", async () => {
    stubHermes({ dirs: '{"a": 1}' })
    expect((await install()).result.hermes.via).toBe("copy")
    expect(calls().filter((call) => call.startsWith("config set"))).toEqual([])
  })

  it("takes out its own earlier copy once Hermes reads the folder, since Hermes refuses a name it finds twice", async () => {
    await install()
    stubHermes({ dirs: "[]" })
    const { result } = await install()

    expect(result.hermes.removed).toBe(hermesCopyPath("tg-cli", env))
    expect(existsSync(join(hermesDir(), "skills", "tg-cli"))).toBe(false)
  })

  it("leaves a copy alone when its folder holds anything else", async () => {
    await install()
    writeFileSync(join(hermesDir(), "skills", "tg-cli", "notes.md"), "mine")
    stubHermes({ dirs: "[]" })
    expect((await install()).result.hermes.removed).toBeUndefined()
    expect(existsSync(hermesCopyPath("tg-cli", env))).toBe(true)
  })

  it("is never part of all, and the daily hint never asks Hermes", async () => {
    stubHermes({ dirs: "[]" })
    await run(["skill", "install"])
    skillHint({ app, argv: ["chats"], env: { ...env, CLAUDECODE: "1" }, statePath: join(dir, "state.json") })
    expect(calls()).toEqual([])
  })

  it("reports the copy Hermes reads: none, the shared folder, or its own copy", async () => {
    expect(hermesSkillStatus(app, { env })).toMatchObject({ state: "missing", via: null })

    stubHermes({ dirs: "[]" })
    await install()
    expect(hermesSkillStatus(app, { env })).toEqual({
      target: "hermes",
      path: skillPath("agents", "tg-cli", env),
      installed: "1.2.0",
      state: "current",
      via: "external_dirs",
    })

    mkdirSync(join(hermesDir(), "skills", "tg-cli"), { recursive: true })
    writeFileSync(hermesCopyPath("tg-cli", env), withVersion(SKILL, "1.1.0"))
    expect(hermesSkillStatus(app, { env })).toMatchObject({ installed: "1.1.0", state: "stale", via: "copy" })
  })
})

describe("skill status", () => {
  const write = (target: "claude" | "agents", content: string) => {
    const path = skillPath(target, "tg-cli", env)
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, content)
  }

  it("reports each target as missing before anything is installed, and writes nothing", async () => {
    const { stdout } = await run(["--json", "skill", "status"])
    expect(JSON.parse(stdout.join(""))).toEqual({
      name: "tg-cli",
      version: "1.2.0",
      targets: [
        { target: "claude", path: skillPath("claude", "tg-cli", env), installed: null, state: "missing" },
        { target: "agents", path: skillPath("agents", "tg-cli", env), installed: null, state: "missing" },
        { target: "hermes", path: skillPath("agents", "tg-cli", env), installed: null, state: "missing", via: null },
      ],
    })
    expect(() => readFileSync(skillPath("claude", "tg-cli", env))).toThrow()
  })

  it("tells a current copy from an older one, and a copy with no version", async () => {
    write("claude", withVersion(SKILL, "1.2.0"))
    write("agents", withVersion(SKILL, "1.1.9"))
    const states = async () =>
      JSON.parse((await run(["--json", "skill", "status"])).stdout.join("")).targets.map(
        ({ installed, state }: { installed: string | null; state: string }) => [installed, state],
      )
    expect(await states()).toEqual([
      ["1.2.0", "current"],
      ["1.1.9", "stale"],
      [null, "missing"],
    ])

    write("agents", SKILL)
    write("claude", "---\nname: tg-cli\nversion: 1.1.0\n---\n")
    expect(await states()).toEqual([
      ["1.1.0", "stale"],
      [null, "unversioned"],
      [null, "missing"],
    ])
  })
})

describe("skillHint", () => {
  const AGENT = { CLAUDECODE: "1" }
  const clock = fakeClock(1_000_000)
  const hint = (overrides: { env?: Record<string, string>; enabled?: boolean; argv?: string[] } = {}) =>
    skillHint({
      app,
      argv: overrides.argv ?? ["chats", "list"],
      env: { ...env, ...(overrides.env ?? AGENT) },
      statePath: join(dir, "state", "update-check.json"),
      now: () => clock.now().getTime(),
      ...(overrides.enabled === undefined ? {} : { enabled: overrides.enabled }),
    })
  const install = (version: string, target: "claude" | "agents" = "claude") => {
    const path = skillPath(target, "tg-cli", env)
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, withVersion(SKILL, version))
  }

  it("tells an agent the skill is missing", () => {
    expect(hint()).toBe("agents: `tg skill install` installs this tool's guide")
    expect(hint({ env: { AI_AGENT: "claude-code_2.1_agent" } })).toBeUndefined()
  })

  it("tells an agent whose copy is older than the CLI", () => {
    install("1.2.0")
    install("1.1.9", "agents")
    expect(hint()).toBeDefined()
  })

  it("stays quiet when the installed copy is current, even in one location only", () => {
    install("1.2.0")
    expect(hint()).toBeUndefined()
  })

  it("says nothing to a person", () => {
    expect(hint({ env: {} })).toBeUndefined()
  })

  it("says it at most once a day", () => {
    expect(hint()).toBeDefined()
    clock.advance(23 * 60 * 60 * 1000)
    expect(hint()).toBeUndefined()
    clock.advance(60 * 60 * 1000)
    expect(hint()).toBeDefined()
  })

  it("says nothing when turned off, or while the skill command itself runs", () => {
    expect(hint({ enabled: false })).toBeUndefined()
    expect(hint({ argv: ["skill", "install"] })).toBeUndefined()
    expect(hint()).toBeDefined()
  })

  it("shares the update notice's file without either losing the other's answer", () => {
    const statePath = join(dir, "state", "update-check.json")
    hint()
    expect(readUpdateState(statePath)).toBeUndefined()

    writeUpdateState(statePath, { checkedAt: 5, latest: "1.3.0" })
    clock.advance(60 * 60 * 1000)
    expect(hint()).toBeUndefined()
    expect(readUpdateState(statePath)).toMatchObject({ checkedAt: 5, latest: "1.3.0" })
  })
})

describe("skillResource", () => {
  it("serves SKILL.md as <command>://skill and names the install command", () => {
    const resource = skillResource(app, skill)
    expect(resource).toMatchObject({ uri: "tg://skill", mimeType: "text/markdown" })
    expect(resource.read()).toEqual({ contents: [{ uri: "tg://skill", mimeType: "text/markdown", text: SKILL }] })
    expect(resource.instruction).toContain("`tg skill install`")
  })
})
