import type { ChildProcessWithoutNullStreams } from "node:child_process"
import crossSpawn from "cross-spawn"
import { executableEnvironment, executableOnPath } from "../executable.js"

export type McpClient = "codex" | "claude-code"

export interface StdioEntry {
  type: "stdio"
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface CommandResult {
  status: number | null
  error?: Error
  stdout: string
  stderr: string
}

export type RunCommand = (file: string, args: string[]) => CommandResult

const realRun: RunCommand = (file, args) => {
  const result = crossSpawn.sync(executableOnPath(file, process.env), args, {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 256_000,
    env: executableEnvironment(process.env),
  })
  return { status: result.status, error: result.error, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

const executable = (client: McpClient): string => (client === "codex" ? "codex" : "claude")

const presentIn = (client: McpClient, name: string, run: RunCommand): boolean => {
  const state = lookUp(client, name, run)
  if (state === "unavailable") throw new Error(`${executable(client)} is not installed or could not be started`)
  return state === "registered"
}

export const setupArguments = (client: McpClient, name: string, entry: StdioEntry): string[] => {
  const variables = Object.entries(entry.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`])
  if (client === "codex") return ["mcp", "add", name, ...variables, "--", entry.command, ...entry.args]
  return ["mcp", "add", "--scope", "user", name, ...variables, "--", entry.command, ...entry.args]
}

const checkName = (name: string) => {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) throw new Error("the MCP name must be letters, digits, _ or -")
}

/** `unavailable`: the client is not installed here, or could not be started. */
export type StdioEntryState = "registered" | "missing" | "unavailable"

const lookUp = (client: McpClient, name: string, run: RunCommand): StdioEntryState => {
  const file = executable(client)
  const existing = run(file, ["mcp", "get", name, ...(client === "codex" ? ["--json"] : [])])
  if (existing.error) return "unavailable"
  if (existing.status === 0) return "registered"
  if (!/No MCP server named/i.test(existing.stdout + existing.stderr)) {
    throw new Error(`${file} could not check its MCP configuration`)
  }
  return "missing"
}

/** Whether the client has a server by this name; reads only, through the client's own `mcp get`. */
export const stdioEntryStatus = (
  client: McpClient,
  name: string,
  { run = realRun }: { run?: RunCommand } = {},
): { client: McpClient; name: string; state: StdioEntryState } => {
  checkName(name)
  return { client, name, state: lookUp(client, name, run) }
}

export const removeArguments = (client: McpClient, name: string): string[] =>
  // Claude Code without a scope removes from whichever scope holds the name, which may be a project's own entry.
  client === "codex" ? ["mcp", "remove", name] : ["mcp", "remove", "--scope", "user", name]

/** Takes out what `installStdioEntry` added; a name the client does not have is left alone and reported. */
export const removeStdioEntry = (
  client: McpClient,
  name: string,
  { run = realRun }: { run?: RunCommand } = {},
): { client: McpClient; name: string; removed: boolean } => {
  checkName(name)
  if (!presentIn(client, name, run)) return { client, name, removed: false }
  const file = executable(client)
  const removed = run(file, removeArguments(client, name))
  if (removed.status !== 0 || removed.error) throw new Error(`${file} could not remove ${name}`)
  return { client, name, removed: true }
}

export const installStdioEntry = (
  client: McpClient,
  name: string,
  entry: StdioEntry,
  { run = realRun }: { run?: RunCommand } = {},
): { client: McpClient; name: string; command: string[] } => {
  checkName(name)
  if (!entry.command || entry.args.some((arg) => arg.includes("\0"))) throw new Error("invalid MCP command")
  const file = executable(client)
  if (presentIn(client, name, run)) throw new Error(`${name} is already configured in ${file}; remove it there first`)
  const args = setupArguments(client, name, entry)
  const added = run(file, args)
  if (added.status !== 0 || added.error) throw new Error(`${file} could not add ${name}`)
  return { client, name, command: [entry.command, ...entry.args] }
}

export interface ProbeResult {
  tools: string[]
  potentialWrites: string[]
}

export const probeStdio = async (
  entry: StdioEntry,
  {
    timeoutMs = 10_000,
    start = (file: string, args: string[], env: NodeJS.ProcessEnv) =>
      crossSpawn(executableOnPath(file, env), args, {
        env: executableEnvironment(env),
        stdio: "pipe",
      }) as ChildProcessWithoutNullStreams,
  }: {
    timeoutMs?: number
    start?: (file: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams
  } = {},
): Promise<ProbeResult> => {
  const child = start(entry.command, entry.args, { ...process.env, ...entry.env })
  let buffer = ""
  let timer: NodeJS.Timeout | undefined
  const pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (reason: Error) => void }
  >()
  const request = (id: number, method: string, params: object) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    })
  const fail = (error: Error) => {
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  }
  child.on("error", () => fail(new Error("the MCP server could not be started")))
  child.on("exit", () => fail(new Error("the MCP server exited before answering")))
  child.stdin.on("error", () => fail(new Error("the MCP server closed its input")))
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk
    if (buffer.length > 1_000_000) return fail(new Error("the MCP server sent too much output"))
    for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      try {
        const value = JSON.parse(line) as { id?: unknown; result?: Record<string, unknown>; error?: unknown }
        if (typeof value.id !== "number") continue
        const waiter = pending.get(value.id)
        if (!waiter) continue
        pending.delete(value.id)
        if (value.error) waiter.reject(new Error("the MCP server rejected the handshake"))
        else waiter.resolve(value.result ?? {})
      } catch {
        fail(new Error("the MCP server sent invalid JSON"))
      }
    }
  })
  try {
    timer = setTimeout(() => fail(new Error("the MCP server did not answer in time")), timeoutMs)
    await request(1, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "cli-base-mcp-doctor", version: "1" },
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`)
    const result = await request(2, "tools/list", {})
    const tools = result.tools
    if (!Array.isArray(tools)) throw new Error("the MCP server returned no tool list")
    const named = tools.filter(
      (item): item is { name: string; annotations?: { readOnlyHint?: boolean } } =>
        item !== null && typeof item === "object" && "name" in item && typeof item.name === "string",
    )
    if (named.length !== tools.length) throw new Error("the MCP server returned an invalid tool list")
    return {
      tools: named.map((item) => item.name),
      potentialWrites: named.filter((item) => item.annotations?.readOnlyHint !== true).map((item) => item.name),
    }
  } finally {
    if (timer) clearTimeout(timer)
    pending.clear()
    child.stdin.end()
    child.kill()
  }
}
