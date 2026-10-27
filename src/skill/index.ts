/**
 * The CLI's own SKILL.md for coding agents: printing it, installing it where agents look for skills,
 * telling an agent once a day that its copy is missing or old, and serving it to an MCP client.
 *
 * Nothing here prints by itself. The command writes through the renderer and streams the host hands
 * it, and the hint is a string the host puts on stderr — never stdout, which an agent parses.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Command, Option } from "commander"
import crossSpawn from "cross-spawn"
import { annotate } from "../commands/index.js"
import { CliError } from "../errors.js"
import { executableEnvironment, executableOnPath } from "../executable.js"
import type { Renderer } from "../renderer.js"
import type { Streams } from "../streams.js"
import { CHECK_EVERY_MS, isNewer, readNoticeState, writeUpdateState } from "../update/index.js"

type Env = Readonly<Record<string, string | undefined>>

export interface SkillApp {
  /** `tg` — what an agent types. */
  command: string
  /** `tg-cli` — the skill's directory name, and the `name` in its frontmatter. */
  appName: string
  version: string
}

export const SKILL_TARGETS = ["claude", "agents"] as const
export type SkillTarget = (typeof SKILL_TARGETS)[number]

const homeOf = (env: Env): string => env.HOME || env.USERPROFILE || homedir()

/** `~/.claude/skills` is Claude Code's; `~/.agents/skills` is read by Codex, Gemini CLI and OpenClaw. */
export const skillPath = (target: SkillTarget, appName: string, env: Env): string =>
  join(homeOf(env), target === "claude" ? ".claude" : ".agents", "skills", appName, "SKILL.md")

const FRONTMATTER = /^---(\r?\n)([\s\S]*?\r?\n)?---(\r?\n|$)/
const scalar = (key: string, indent: string) =>
  new RegExp(`^${indent}${key}:[ \\t]*["']?([^"'\\r\\n]*?)["']?[ \\t]*\\r?\\n?$`)

const frontmatterLines = (content: string): string[] => (FRONTMATTER.exec(content)?.[2] ?? "").split(/(?<=\n)/)

/** Where `metadata:` and its indented lines are, as `[start, end)`; a flow map (`metadata: {…}`) is refused. */
const metadataBlock = (lines: readonly string[]): [number, number] | undefined => {
  const start = lines.findIndex((line) => /^metadata:/.test(line))
  if (start === -1) return undefined
  if (!/^metadata:[ \t]*\r?\n?$/.test(lines[start] as string)) {
    throw new CliError("configuration_error", "SKILL.md: write `metadata` as an indented block, not on one line")
  }
  let end = start + 1
  while (end < lines.length && /^[ \t]/.test(lines[end] as string)) end++
  return [start, end]
}

/**
 * `metadata.version` from the frontmatter — where the Agent Skills specification keeps fields of its
 * own — or a top-level `version:`, which pre-release builds of this package wrote.
 */
export const skillVersion = (content: string): string | undefined => {
  const lines = frontmatterLines(content)
  const block = metadataBlock(lines)
  const nested = block && lines.slice(block[0] + 1, block[1]).find((line) => scalar("version", "[ \\t]+").test(line))
  const line = nested ?? lines.find((line) => scalar("version", "").test(line))
  return line === undefined ? undefined : scalar("version", "[ \\t]*").exec(line)?.[1]
}

const skillName = (content: string): string | undefined => {
  const line = frontmatterLines(content).find((line) => scalar("name", "").test(line))
  return line === undefined ? undefined : scalar("name", "").exec(line)?.[1]
}

/** Adds or replaces `metadata.version` as a string; every other byte stays as it was. */
export const withVersion = (content: string, version: string): string => {
  const match = FRONTMATTER.exec(content)
  if (!match) return `---\nmetadata:\n  version: "${version}"\n---\n${content}`
  const [whole, eol = "\n", body = "", close = ""] = match
  const lines = body.split(/(?<=\n)/).filter((line) => line !== "")
  const block = metadataBlock(lines)
  if (!block) {
    lines.push(`metadata:${eol}`, `  version: "${version}"${eol}`)
  } else {
    const [start, end] = block
    const indent = /^[ \t]+/.exec(lines[start + 1] ?? "")?.[0] ?? "  "
    const at = lines.slice(start + 1, end).findIndex((line) => scalar("version", "[ \\t]+").test(line))
    if (at === -1) lines.splice(start + 1, 0, `${indent}version: "${version}"${eol}`)
    else {
      const old = lines[start + 1 + at] as string
      const lineEol = /\r?\n$/.exec(old)?.[0] ?? ""
      lines[start + 1 + at] = `${/^[ \t]+/.exec(old)?.[0]}version: "${version}"${lineEol}`
    }
  }
  return `---${eol}${lines.join("")}---${close}${content.slice(whole.length)}`
}

/** Writes the stamped SKILL.md to each target, creating directories; the same run twice gives the same files. */
export const installSkill = (
  app: SkillApp,
  skill: URL,
  { targets = SKILL_TARGETS, env = process.env }: { targets?: readonly SkillTarget[]; env?: Env } = {},
): string[] => {
  const source = readFileSync(skill, "utf8")
  // The specification requires it, and an agent that checks skips a skill whose name and directory differ.
  const name = skillName(source)
  if (name !== app.appName) {
    throw new CliError(
      "configuration_error",
      `SKILL.md is named ${name === undefined ? "nothing" : `"${name}"`}, but installs into a directory "${app.appName}"; the two must match`,
    )
  }
  const content = withVersion(source, app.version)
  return targets.map((target) => {
    const path = skillPath(target, app.appName, env)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    return path
  })
}

export type SkillState = "current" | "stale" | "missing" | "unversioned"

export interface SkillTargetStatus {
  target: SkillTarget
  path: string
  /** The `metadata.version` of the installed copy; `null` when there is none or it has no version. */
  installed: string | null
  state: SkillState
}

/** Each target's installed copy against this CLI's version; reads only, and an unreadable file is missing. */
export const skillStatus = (app: SkillApp, env: Env = process.env): SkillTargetStatus[] =>
  SKILL_TARGETS.map((target) => {
    const path = skillPath(target, app.appName, env)
    return { target, ...(copyStatus(app, path) ?? { path, installed: null, state: "missing" }) }
  })

const copyStatus = (app: SkillApp, path: string): Omit<SkillTargetStatus, "target"> | undefined => {
  let content: string
  try {
    content = readFileSync(path, "utf8")
  } catch {
    return undefined
  }
  const installed = skillVersion(content)
  if (installed === undefined) return { path, installed: null, state: "unversioned" }
  return { path, installed, state: isNewer(app.version, installed) ? "stale" : "current" }
}

export interface ProgramResult {
  status: number | null
  error?: Error
  stdout: string
}

/** Runs a program with no shell, found and started with the `env` given, never `process.env`. */
export type RunProgram = (file: string, args: readonly string[], env: Env) => ProgramResult

const runProgram: RunProgram = (file, args, env) => {
  const result = crossSpawn.sync(executableOnPath(file, env), [...args], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 256_000,
    env: executableEnvironment(env),
  })
  return { status: result.status, ...(result.error ? { error: result.error } : {}), stdout: result.stdout ?? "" }
}

/** How Hermes reads the skill: the `~/.agents/skills` folder listed in its `skills.external_dirs`, or a copy of its own. */
export type HermesRoute = "external_dirs" | "copy"

/** `HERMES_HOME`, else the folder Hermes itself defaults to. */
export const hermesHome = (env: Env, platform: NodeJS.Platform = process.platform): string => {
  const set = env.HERMES_HOME?.trim()
  if (set) return set
  if (platform === "win32") return join(env.LOCALAPPDATA || join(homeOf(env), "AppData", "Local"), "hermes")
  return join(homeOf(env), ".hermes")
}

export const hermesCopyPath = (appName: string, env: Env): string =>
  join(hermesHome(env), "skills", appName, "SKILL.md")

const EXTERNAL_DIRS = "skills.external_dirs"

/**
 * The folders Hermes lists in `skills.external_dirs`, as its own `config get` answers, or `undefined` when Hermes
 * cannot be asked or the setting is neither a list nor one folder — a value this code must never overwrite.
 */
const externalDirs = (env: Env, run: RunProgram): string[] | undefined => {
  const answer = run("hermes", ["config", "get", EXTERNAL_DIRS, "--json"], env)
  if (answer.error || answer.status !== 0) return undefined
  let value: unknown
  try {
    value = JSON.parse(answer.stdout)
  } catch {
    return undefined
  }
  if (value === null) return []
  if (typeof value === "string") return [value]
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined
}

/** Hermes expands `~` and environment variables in each entry before it resolves the path. */
const expanded = (entry: string, env: Env): string =>
  resolve(
    entry
      .replace(/^~(?=$|[\\/])/, homeOf(env))
      .replace(/\$\{(\w+)\}|\$(\w+)/g, (whole, braced?: string, bare?: string) => env[braced ?? bare ?? ""] ?? whole),
  )

const lists = (dirs: readonly string[], folder: string, env: Env): boolean =>
  dirs.some((entry) => expanded(entry, env) === resolve(folder))

export interface HermesInstall {
  via: HermesRoute
  /** The file Hermes reads. */
  path: string
  /** Why the copy was written instead, when it was. */
  reason?: string
  /** An earlier copy this CLI wrote, taken out because Hermes refuses a skill name it finds twice. */
  removed?: string
}

/** Our own earlier copy, alone in its folder: anything else there was put by someone else and stays. */
const removeOwnCopy = (appName: string, env: Env): string | undefined => {
  const path = hermesCopyPath(appName, env)
  try {
    if (readdirSync(dirname(path)).join() !== "SKILL.md") return undefined
    if (skillName(readFileSync(path, "utf8")) !== appName) return undefined
    rmSync(path)
    rmdirSync(dirname(path))
    return path
  } catch {
    return undefined
  }
}

/** Has Hermes list `folder` in `skills.external_dirs`, keeping the folders there; why not, when it does not. */
const readFolder = (folder: string, env: Env, run: RunProgram): string | undefined => {
  const dirs = externalDirs(env, run)
  if (dirs === undefined) return "Hermes could not be asked for skills.external_dirs"
  if (lists(dirs, folder, env)) return undefined
  const set = run("hermes", ["config", "set", EXTERNAL_DIRS, JSON.stringify([...dirs, folder])], env)
  if (set.error || set.status !== 0) return "hermes config set failed"
  const after = externalDirs(env, run)
  return after !== undefined && lists(after, folder, env) ? undefined : "Hermes did not keep the folder"
}

/**
 * Writes the skill to `~/.agents/skills`, then has Hermes read that folder by adding it to `skills.external_dirs`
 * with Hermes's own `config set`, keeping every folder already listed. When Hermes is not on PATH, cannot be asked,
 * or does not keep the folder, the skill is copied into `$HERMES_HOME/skills` instead — but only when that home exists:
 * with neither the program nor its home, Hermes is not installed, and nothing is written.
 */
export const installHermesSkill = (
  app: SkillApp,
  skill: URL,
  { env = process.env, run = runProgram }: { env?: Env; run?: RunProgram } = {},
): { written: string[]; hermes: HermesInstall } => {
  if (!existsSync(hermesHome(env)) && run("hermes", ["--version"], env).error)
    throw new CliError("not_found", "Hermes is not installed here; install Hermes first, or set HERMES_HOME")
  const [shared] = installSkill(app, skill, { targets: ["agents"], env }) as [string]
  const reason = readFolder(dirname(dirname(shared)), env, run)
  if (reason === undefined) {
    const removed = removeOwnCopy(app.appName, env)
    return { written: [shared], hermes: { via: "external_dirs", path: shared, ...(removed ? { removed } : {}) } }
  }
  const copy = hermesCopyPath(app.appName, env)
  mkdirSync(dirname(copy), { recursive: true })
  writeFileSync(copy, readFileSync(shared))
  return { written: [shared, copy], hermes: { via: "copy", path: copy, reason } }
}

export interface HermesSkillStatus extends Omit<SkillTargetStatus, "target"> {
  /** How Hermes reads the copy reported; `null` when it reads none. */
  via: HermesRoute | null
}

/**
 * The copy Hermes reads: its own `skills/<app>` first, as Hermes scans it first, else the `~/.agents/skills` one when
 * `skills.external_dirs` lists that folder. Asks Hermes through `config get` when its home exists, so a host calls it
 * only when asked.
 */
export const hermesSkillStatus = (
  app: SkillApp,
  { env = process.env, run = runProgram }: { env?: Env; run?: RunProgram } = {},
): HermesSkillStatus => {
  const own = copyStatus(app, hermesCopyPath(app.appName, env))
  if (own) return { ...own, via: "copy" }
  const shared = skillPath("agents", app.appName, env)
  // Asked with no home of its own, Hermes creates one: a status that only reads never starts it there.
  const dirs = existsSync(hermesHome(env)) ? externalDirs(env, run) : undefined
  const read = dirs !== undefined && lists(dirs, dirname(dirname(shared)), env) ? copyStatus(app, shared) : undefined
  if (read) return { ...read, via: "external_dirs" }
  return { path: shared, installed: null, state: "missing", via: null }
}

/** What the command writes to and where home is, for this invocation — the host's own output resolution. */
export type SkillEnvironment = (command: Command) => { renderer: Renderer; streams: Streams; env?: Env }

/**
 * `more`: skills a library ships for every CLI built on it, by name — `skill show <name>` prints one with
 * `{{command}}` turned into this CLI's command. They are printed, not installed: two CLIs would install
 * the same name.
 */
export const skillCommand = (
  app: SkillApp,
  skill: URL,
  environment: SkillEnvironment,
  more: Readonly<Record<string, URL>> = {},
): Command => {
  const command = new Command("skill").description("the instructions an agent is given for this tool")
  const machine = (self: Command) => {
    const { json, jsonl } = self.optsWithGlobals<{ json?: boolean; jsonl?: boolean }>()
    return json === true || jsonl === true
  }

  const named = Object.keys(more)
  const show = annotate(command.command("show"), { effects: { remote: "none", local: "read" } })
    .summary("print the tool's instructions for AI agents")
    .description(
      `print SKILL.md — \`${app.command} skill install\` puts it where Claude Code, Codex, Gemini CLI and OpenClaw look for it, and where Hermes does on request; --for prints the copy already there`,
    )
  if (named.length > 0) show.argument("[name]", `one of the skills shipped for a task: ${named.join(", ")}`)
  show.addOption(
    new Option("--for <agents>", "print the copy installed for these agents instead of this version's").choices(
      SKILL_TARGETS,
    ),
  )
  show.action(function (this: Command, given: unknown) {
    // Without a declared argument Commander passes the options here, not a name.
    const name = typeof given === "string" ? given : undefined
    const { renderer, streams, env } = environment(this)
    const { for: target } = this.opts<{ for?: SkillTarget }>()
    if (target !== undefined) {
      if (name !== undefined)
        throw new CliError("validation_error", `only ${app.appName} is installed; leave out "${name}" with --for`)
      const path = skillPath(target, app.appName, env ?? process.env)
      let content: string
      try {
        content = readFileSync(path, "utf8").trimEnd()
      } catch {
        throw new CliError(
          "not_found",
          `no skill is installed for ${target} at ${path} — \`${app.command} skill install --for ${target}\` writes it`,
        )
      }
      if (machine(this))
        renderer.result({ name: app.appName, target, path, installed: skillVersion(content) ?? null, content })
      else streams.data(content)
      return
    }
    const source = name === undefined ? skill : more[name]
    if (!source) {
      throw new CliError("validation_error", `no skill "${name}" — there are: ${named.join(", ")}`)
    }
    const content =
      name === undefined
        ? readFileSync(source, "utf8").trimEnd()
        : readFileSync(source, "utf8").trimEnd().replaceAll("{{command}}", app.command)
    // The file itself even into a pipe: saving it is a redirect, and a redirect is where every
    // other command switches to JSON. Asked for by name, it is JSON like the rest.
    if (machine(this)) renderer.result({ name: name ?? app.appName, content })
    else streams.data(content)
  })

  annotate(command.command("install"), { effects: { remote: "none", local: "write" } })
    .summary("install the tool's instructions for AI agents")
    .description(
      `write SKILL.md to ~/.claude/skills/${app.appName}/ (Claude Code) and ~/.agents/skills/${app.appName}/ (Codex, Gemini CLI, OpenClaw); --for hermes also has Hermes read ~/.agents/skills, which changes Hermes's own settings, so all leaves it out`,
    )
    .addOption(
      new Option("--for <agents>", "which agents to install for")
        .choices(["claude", "agents", "hermes", "all"])
        .default("all"),
    )
    .action(function (this: Command, { for: chosen }: { for: "claude" | "agents" | "hermes" | "all" }) {
      const { renderer, env } = environment(this)
      if (chosen === "hermes") {
        const { written, hermes } = installHermesSkill(app, skill, env ? { env } : {})
        renderer.result({ name: app.appName, version: app.version, written, hermes })
        renderer.success(
          hermes.via === "external_dirs"
            ? `${app.appName} ${app.version} skill installed: ${hermes.path}; Hermes reads ${dirname(dirname(hermes.path))} (skills.external_dirs)`
            : `${app.appName} ${app.version} skill installed: ${hermes.path}, a copy for Hermes (${hermes.reason})`,
        )
        if (hermes.removed) renderer.note(`removed the earlier copy Hermes would also have found: ${hermes.removed}`)
        return
      }
      const targets = chosen === "all" ? SKILL_TARGETS : [chosen]
      const written = installSkill(app, skill, { targets, ...(env ? { env } : {}) })
      renderer.result({ name: app.appName, version: app.version, written })
      renderer.success(`${app.appName} ${app.version} skill installed: ${written.join(", ")}`)
    })

  annotate(command.command("status"), {
    effects: { remote: "none", local: "read" },
    examples: [`${app.command} skill status`, `${app.command} skill status --json`],
  })
    .summary("whether the installed instructions for AI agents match this version")
    .description(
      `for each place \`${app.command} skill install\` writes to, and for the copy Hermes reads: the path, the version installed there, and whether it is current, stale, missing or unversioned`,
    )
    .action(function (this: Command) {
      const { renderer, env } = environment(this)
      // Hermes is its own key, not a third target: it is no folder `skill install` writes, and a caller that
      // expects the two targets keeps working.
      const targets = skillStatus(app, env ?? process.env)
      const hermes = hermesSkillStatus(app, env ? { env } : {})
      renderer.result({ name: app.appName, version: app.version, targets, hermes })
    })

  return command
}

export interface SkillHintRequest {
  app: SkillApp
  /** The words the CLI was run with: no hint while it runs `skill` or `complete`. */
  argv: readonly string[]
  env: Env
  /** The update notice's state file — one file for both daily notices. */
  statePath: string
  /** The setting `skillHint`; `false` turns the hint off. */
  enabled?: boolean
  now?: () => number
}

const isAgent = (env: Env): boolean => Boolean(env.AI_AGENT || env.CLAUDECODE)

const needsInstall = (app: SkillApp, env: Env): boolean => {
  const states = skillStatus(app, env).map(({ state }) => state)
  // A location never installed to is a choice (`--for claude`); only no copy at all, or an old one, is worth a line.
  return (
    states.every((state) => state === "missing") || states.some((state) => state === "stale" || state === "unversioned")
  )
}

/**
 * One line for an agent whose copy of SKILL.md is missing or older than this CLI, at most once a
 * day, or `undefined`. The host prints it on stderr. Any failure is silence.
 */
export const skillHint = ({ app, argv, env, statePath, enabled = true, now = Date.now }: SkillHintRequest) => {
  try {
    if (!enabled || !isAgent(env)) return undefined
    if (argv.includes("skill") || argv.includes("complete")) return undefined
    const at = now()
    const shown = readNoticeState(statePath).skillHintAt
    if (shown !== undefined && at - shown < CHECK_EVERY_MS) return undefined
    if (!needsInstall(app, env)) return undefined
    writeUpdateState(statePath, { skillHintAt: at })
    return `agents: \`${app.command} skill install\` installs this tool's guide`
  } catch {
    return undefined
  }
}

export interface SkillResource {
  uri: string
  name: string
  title: string
  description: string
  mimeType: "text/markdown"
  read: () => { contents: { uri: string; mimeType: "text/markdown"; text: string }[] }
  /** A line for the server's `instructions`. */
  instruction: string
}

/**
 * What an MCP server registers to serve SKILL.md as `<command>://skill`, for a client with no shell —
 * `server.registerResource(r.name, r.uri, { title, description, mimeType }, r.read)`. The SDK stays the host's.
 */
export const skillResource = (app: SkillApp, skill: URL): SkillResource => {
  const uri = `${app.command}://skill`
  return {
    uri,
    name: "skill",
    title: `${app.appName} SKILL.md`,
    description: `How to use ${app.command}: the guide an agent is given for this tool.`,
    mimeType: "text/markdown",
    read: () => ({ contents: [{ uri, mimeType: "text/markdown", text: readFileSync(skill, "utf8") }] }),
    instruction: `- The full guide is the resource ${uri}; \`${app.command} skill install\` installs it as an agent skill.`,
  }
}
