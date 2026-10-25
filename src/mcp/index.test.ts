import { describe, expect, it } from "vitest"
import {
  installStdioEntry,
  probeStdio,
  type RunCommand,
  removeStdioEntry,
  type StdioEntry,
  setupArguments,
  stdioEntryStatus,
} from "./index.js"

const entry: StdioEntry = {
  type: "stdio",
  command: "/usr/bin/node",
  args: ["/opt/max/dist/bin/max.js", "work", "mcp"],
  env: { MAX_CONFIG_DIR: "/tmp/work config" },
}

describe("local MCP setup", () => {
  it("uses the clients' own commands and preserves paths and environment values as arguments", () => {
    expect(setupArguments("codex", "max-work", entry)).toEqual([
      "mcp",
      "add",
      "max-work",
      "--env",
      "MAX_CONFIG_DIR=/tmp/work config",
      "--",
      "/usr/bin/node",
      "/opt/max/dist/bin/max.js",
      "work",
      "mcp",
    ])
    expect(setupArguments("claude-code", "max-work", entry)).toEqual([
      "mcp",
      "add",
      "--scope",
      "user",
      "max-work",
      "--env",
      "MAX_CONFIG_DIR=/tmp/work config",
      "--",
      "/usr/bin/node",
      "/opt/max/dist/bin/max.js",
      "work",
      "mcp",
    ])
  })

  it("refuses an existing entry without removing it", () => {
    const calls: string[][] = []
    expect(() =>
      installStdioEntry("codex", "max-work", entry, {
        run: (_file, args) => {
          calls.push(args)
          return { status: 0, stdout: "{}", stderr: "" }
        },
      }),
    ).toThrow("already configured")
    expect(calls).toEqual([["mcp", "get", "max-work", "--json"]])
  })

  it("adds a missing entry without touching other entries", () => {
    const calls: string[][] = []
    const installed = installStdioEntry("claude-code", "tg", entry, {
      run: (_file, args) => {
        calls.push(args)
        return calls.length === 1
          ? { status: 1, stdout: 'No MCP server named "tg"', stderr: "" }
          : { status: 0, stdout: "Added", stderr: "" }
      },
    })
    expect(installed.name).toBe("tg")
    expect(calls.map((args) => args.slice(0, 2))).toEqual([
      ["mcp", "get"],
      ["mcp", "add"],
    ])
  })
})

const missing = { status: 1, stdout: 'No MCP server named "tg"', stderr: "" }
const recording = (answers: ReturnType<RunCommand>[]) => {
  const calls: string[][] = []
  const run: RunCommand = (_file, args) => {
    calls.push(args)
    return answers[calls.length - 1] ?? { status: 0, stdout: "", stderr: "" }
  }
  return { calls, run }
}

describe("local MCP removal", () => {
  it("removes Claude Code's user entry only, never a project's entry of the same name", () => {
    const { calls, run } = recording([{ status: 0, stdout: "tg:", stderr: "" }])
    expect(removeStdioEntry("claude-code", "tg", { run })).toEqual({ client: "claude-code", name: "tg", removed: true })
    expect(calls).toEqual([
      ["mcp", "get", "tg"],
      ["mcp", "remove", "--scope", "user", "tg"],
    ])
  })

  it("removes a Codex entry by name", () => {
    const { calls, run } = recording([{ status: 0, stdout: "{}", stderr: "" }])
    expect(removeStdioEntry("codex", "tg-work", { run }).removed).toBe(true)
    expect(calls.at(-1)).toEqual(["mcp", "remove", "tg-work"])
  })

  it("leaves a name the client does not have and says nothing was removed", () => {
    const { calls, run } = recording([missing])
    expect(removeStdioEntry("codex", "tg", { run }).removed).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it("fails when the client refuses the removal", () => {
    const { run } = recording([
      { status: 0, stdout: "{}", stderr: "" },
      { status: 1, stdout: "", stderr: "" },
    ])
    expect(() => removeStdioEntry("codex", "tg", { run })).toThrow("could not remove tg")
  })

  it("refuses a name that could reach the client as an option", () => {
    expect(() => removeStdioEntry("codex", "--all", { run: recording([]).run })).toThrow("letters, digits")
  })
})

describe("local MCP status", () => {
  it("says registered, missing or unavailable for each client", () => {
    expect(stdioEntryStatus("codex", "tg", recording([{ status: 0, stdout: "{}", stderr: "" }])).state).toBe(
      "registered",
    )
    expect(stdioEntryStatus("claude-code", "tg", recording([missing])).state).toBe("missing")
    const absent = recording([{ status: null, error: new Error("ENOENT"), stdout: "", stderr: "" }])
    expect(stdioEntryStatus("claude-code", "tg", absent)).toEqual({
      client: "claude-code",
      name: "tg",
      state: "unavailable",
    })
  })

  it("fails on an answer it cannot read rather than guess", () => {
    const { run } = recording([{ status: 1, stdout: "", stderr: "config is broken" }])
    expect(() => stdioEntryStatus("codex", "tg", { run })).toThrow("could not check")
  })
})

describe("local MCP doctor", () => {
  it("initializes a stdio server and lists tools without calling them", async () => {
    const program = [
      "const rl = require('node:readline').createInterface({input: process.stdin});",
      "rl.on('line', line => { const m = JSON.parse(line);",
      "if (m.method === 'initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}})+'\\n');",
      "if (m.method === 'tools/list') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'max_status',annotations:{readOnlyHint:true}},{name:'max_messages_send',annotations:{readOnlyHint:false}}]}})+'\\n');",
      "if (m.method === 'tools/call') process.exit(10);",
      "});",
    ].join("")
    await expect(probeStdio({ type: "stdio", command: process.execPath, args: ["-e", program] })).resolves.toEqual({
      tools: ["max_status", "max_messages_send"],
      potentialWrites: ["max_messages_send"],
    })
  })
})
