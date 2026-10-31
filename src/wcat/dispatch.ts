import { randomUUID } from "node:crypto"
import { constants } from "node:os"
import crossSpawn from "cross-spawn"
import { CliError } from "../errors.js"
import type { WcatTool } from "./describe.js"
import { BUILT_IN_COMMANDS, FIRST_PARTY_TOOLS, PROGRAM_PREFIX, TOOL_NAME } from "./names.js"
import { findOnPath, type SearchEnv } from "./path.js"
import { baseVersion, probeDescribe } from "./probe.js"
import { addShortcuts, installedPrograms, listShortcuts, removeShortcuts, type Shortcut } from "./shortcuts.js"

interface Output {
  write: (text: string) => unknown
  isTTY?: boolean
}

export interface WcatContext extends SearchEnv {
  stdout: Output
  stderr: Output
  /** The tool running the dispatcher: described from its metadata, without starting it again. */
  self?: WcatTool
  /** How long one `--wcat-describe` may take; 2 s when left out. */
  describeTimeoutMs?: number
  /** Where SIGTERM and SIGHUP arrive, to pass on to the tool; `process` when left out. */
  signals?: Pick<NodeJS.Process, "on" | "off">
}

export interface ListedTool {
  name: string
  installed: boolean
  /** The program `wcat <name>` starts. */
  path?: string
  version?: string
  description?: string
  docs_url?: string
  /** Other programs with the same name, later on PATH: `wcat` never runs them. */
  shadowed?: string[]
  package?: string
  install?: string
}

const DEFAULT_DESCRIBE_TIMEOUT_MS = 2000

/** Every `wcat-<name>` on PATH with what it says about itself, then WireCat's own tools that are not installed. */
export const listTools = async (context: WcatContext): Promise<ListedTool[]> => {
  const installed = installedPrograms(context)
  const timeoutMs = context.describeTimeoutMs ?? DEFAULT_DESCRIBE_TIMEOUT_MS
  const found = await Promise.all(
    [...installed].map(async ([name, paths]): Promise<ListedTool> => {
      const [path, ...shadowed] = paths
      const own = context.self?.command === name ? context.self : undefined
      const described = own ?? (await probeDescribe(path as string, { env: context.env, timeoutMs }))
      return {
        name,
        installed: true,
        path,
        ...(described?.version ? { version: described.version } : {}),
        ...(described?.description ? { description: described.description } : {}),
        ...(described?.docs ? { docs_url: described.docs } : {}),
        ...(shadowed.length > 0 ? { shadowed } : {}),
      }
    }),
  )
  const missing = FIRST_PARTY_TOOLS.filter((tool) => tool.package && !installed.has(tool.name)).map(
    (tool): ListedTool => ({
      name: tool.name,
      installed: false,
      package: tool.package,
      install: `npm install -g ${tool.package}`,
    }),
  )
  return [...found, ...missing]
}

const envelope = (items: readonly unknown[], started: number) => ({
  items,
  page: { mode: "page", limit: Math.max(items.length, 1), has_more: false },
  meta: { run_id: randomUUID(), duration_ms: Math.max(0, Math.round(performance.now() - started)), complete: true },
})

const column = (rows: readonly (readonly string[])[]) => {
  const widths = rows[0]?.map((_, at) => rows.reduce((wide, row) => Math.max(wide, (row[at] ?? "").length), 0)) ?? []
  return rows.map((row) => `  ${row.map((cell, at) => cell.padEnd(widths[at] ?? 0)).join("  ")}`.trimEnd())
}

const USAGE = [
  "wcat <tool> [arguments]                 run a tool: wcat tg --help",
  "wcat shortcuts [add|remove] [tool...]   short names, such as tg, for installed tools",
  "wcat --json                             the list below as JSON",
]

const listText = (tools: readonly ListedTool[]): string => {
  const installed = tools.filter((tool) => tool.installed)
  const missing = tools.filter((tool) => !tool.installed)
  return [
    "wcat runs WireCat tools, and any other wcat-<name> program on PATH.",
    "",
    ...USAGE,
    "",
    installed.length > 0 ? "Installed:" : "Installed: none",
    ...column(installed.map((tool) => [tool.name, tool.version ?? "", tool.description ?? "(no description)"])),
    ...(missing.length > 0
      ? ["", "Not installed:", ...column(missing.map((tool) => [tool.name, tool.install ?? ""]))]
      : []),
    "",
  ].join("\n")
}

const shadowWarnings = (tools: readonly ListedTool[]): string =>
  tools
    .filter((tool) => tool.shadowed)
    .map(
      (tool) =>
        `wcat: ${(tool.shadowed?.length ?? 0) + 1} programs are named ${PROGRAM_PREFIX}${tool.name}; wcat runs the first:\n${[tool.path, ...(tool.shadowed ?? [])].map((path) => `  ${path}`).join("\n")}\n`,
    )
    .join("")

const shortcutText = (shortcuts: readonly (Shortcut & { changed?: boolean })[]): string => {
  if (shortcuts.length === 0) return "No wcat-<name> programs are installed.\n"
  const said = (shortcut: Shortcut & { changed?: boolean }) => {
    switch (shortcut.status) {
      case "made":
        return `made: ${shortcut.path}`
      case "free":
        return shortcut.changed ? "removed" : "free: wcat shortcuts add makes it"
      case "package":
        return `installed by the package: ${shortcut.path}`
      case "taken":
        return `taken by ${shortcut.path}`
    }
  }
  return `${column(shortcuts.map((shortcut) => [shortcut.name, said(shortcut)])).join("\n")}\n`
}

const signalNumber = (signal: NodeJS.Signals): number => constants.signals[signal] ?? 1

/**
 * Starts `wcat-<name>` with the rest of the words, the same streams and environment, and answers its exit code.
 * SIGTERM and SIGHUP are passed on. Ctrl-C reaches the tool from the terminal by itself, so SIGINT is only kept from
 * ending `wcat` before the tool does.
 */
export const runTool = (path: string, args: readonly string[], context: WcatContext): Promise<number> =>
  new Promise((resolve, reject) => {
    const signals = context.signals ?? process
    const child = crossSpawn(path, [...args], { stdio: "inherit", env: context.env })
    const pass = (signal: NodeJS.Signals) => () => child.kill(signal)
    const term = pass("SIGTERM")
    const hup = pass("SIGHUP")
    const ignore = () => {}
    signals.on("SIGTERM", term).on("SIGHUP", hup).on("SIGINT", ignore)
    const done = () => signals.off("SIGTERM", term).off("SIGHUP", hup).off("SIGINT", ignore)
    child.once("error", (error) => {
      done()
      reject(new CliError("configuration_error", `could not start ${path}: ${error.message}`))
    })
    child.once("exit", (code, signal) => {
      done()
      resolve(code ?? (signal ? 128 + signalNumber(signal) : 1))
    })
  })

const fail = async (error: unknown, json: boolean, context: WcatContext): Promise<number> => {
  const { errorObjectOf, exitCodeOfError, renderError } = await import("../failure.js")
  const object = errorObjectOf(error)
  context.stderr.write(`${renderError(object, { cli: "wcat", interactive: !json })}\n`)
  return exitCodeOfError(object)
}

const shortcuts = async (args: readonly string[], json: boolean, context: WcatContext): Promise<number> => {
  const [action, ...names] = args
  const started = performance.now()
  const result =
    action === "add"
      ? addShortcuts(context, names)
      : action === "remove"
        ? removeShortcuts(context, names)
        : action === undefined || action === "list"
          ? listShortcuts(context, names)
          : undefined
  if (result === undefined)
    throw new CliError("validation_error", `wcat shortcuts takes list, add or remove, not "${action}"`, {
      reason: "input.invalid",
    })
  context.stdout.write(json ? `${JSON.stringify(envelope(result, started))}\n` : shortcutText(result))
  return 0
}

/**
 * `wcat` itself: the words after `wcat`. Built-in commands come first, so a `wcat-<name>` program can never take
 * one over; anything else names a tool, and the rest of the line is that tool's.
 */
export const runWcat = async (args: readonly string[], context: WcatContext): Promise<number> => {
  const [first, ...rest] = args
  // A tool's own --json is the tool's; wcat reads it only for its own answers and for a tool it cannot find.
  const json = args.includes("--json")
  const words = args.filter((word) => word !== "--json")
  const started = performance.now()
  try {
    if (first === "--version" || first === "-V" || first === "version") {
      const tools = await listTools(context)
      const by = context.self ? `, run by ${PROGRAM_PREFIX}${context.self.command} ${context.self.version}` : ""
      context.stdout.write(`wcat ${baseVersion()} (@wirecat/cli-base${by})\n\n${listText(tools)}`)
      return 0
    }
    if (words.length === 0 || first === "--help" || first === "-h" || first === "help") {
      const tools = await listTools(context)
      if (json) context.stdout.write(`${JSON.stringify(envelope(tools, started))}\n`)
      else {
        context.stderr.write(shadowWarnings(tools))
        context.stdout.write(listText(tools))
      }
      return 0
    }
    if (first === "shortcuts") return await shortcuts(words.slice(1), json, context)
    if ((BUILT_IN_COMMANDS as readonly string[]).includes(first as string))
      throw new CliError("validation_error", `wcat ${first} is reserved for a later version of wcat`, {
        reason: "input.invalid",
      })
    if (first?.startsWith("-"))
      throw new CliError("validation_error", `wcat does not take ${first} before a tool's name`, {
        reason: "input.invalid",
      })
    const name = first as string
    const [path, ...shadowed] = TOOL_NAME.test(name) ? findOnPath(`${PROGRAM_PREFIX}${name}`, context) : []
    if (path === undefined) {
      const installed = [...installedPrograms(context).keys()]
      throw new CliError(
        "not_found",
        `no ${PROGRAM_PREFIX}${name} on PATH; installed: ${installed.length > 0 ? installed.join(", ") : "none"}`,
        { reason: "tool.not-installed", tool: name, installed },
      )
    }
    if (shadowed.length > 0 && context.stderr.isTTY)
      context.stderr.write(shadowWarnings([{ name, installed: true, path, shadowed }]))
    return await runTool(path, rest, context)
  } catch (error) {
    return fail(error, json, context)
  }
}
