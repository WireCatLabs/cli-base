import { Command, Option } from "commander"
import { describe, expect, it } from "vitest"
import {
  annotate,
  annotateOption,
  COMMANDS_PAGE_LABELS,
  commandsDocument,
  commandsDocumentJsonSchema,
  commandsPage,
  describeOptions,
  describeProgram,
  flatten,
  metaOf,
  parseCommandsDocument,
  refuseJoinedPath,
  stepTargets,
} from "./index.js"

const SEND = { remote: "write", local: "none" } as const

const program = (): Command => {
  const root = new Command("tool").description("a tool").option("--json", "print JSON")

  const messages = root.command("messages").description("messages in a chat")
  messages
    .command("list")
    .summary("list messages")
    .description("list the messages of one chat")
    .argument("<chat>", "chat id or name")
    .option("--limit <n>", "how many", "20")
    .addOption(new Option("--sort <order>", "order").choices(["new", "old"]))
    .addOption(new Option("--token <token>", "who you are").env("TOOL_TOKEN").makeOptionMandatory())
    .addOption(new Option("--offline", "read the cache only").conflicts("online"))
    .addOption(new Option("--online", "always ask the server").implies({ refresh: true }))
    .addOption(new Option("--debug-wire", "dump frames").hideHelp())
  annotate(messages.command("send").argument("<chat>").argument("[text...]"), {
    effects: SEND,
    examples: ["tool messages send 42 hello"],
  })

  const catalog = root.command("campaigns").description("generated from the catalog")
  for (const id of ["campaigns.list", "campaigns.details"]) {
    annotate(catalog.command(id.split(".")[1] as string), { origin: "generated", api_operation: id })
  }

  annotate(root.command("legacy"), { state: "deprecated" })
  return root
}

describe("describeProgram", () => {
  it("lists every command, nested, with the argv path already split", () => {
    const paths = flatten(describeProgram(program())).map(({ path }) => path.join(" "))
    expect(paths).toEqual([
      "messages",
      "messages list",
      "messages send",
      "campaigns",
      "campaigns list",
      "campaigns details",
      "legacy",
    ])
  })

  it("shows a command built in a loop exactly like a handwritten one, and says where each came from", () => {
    const commands = flatten(describeProgram(program()))
    const list = commands.find(({ path }) => path.join(" ") === "campaigns list")
    const handwritten = commands.find(({ path }) => path.join(" ") === "messages list")

    expect(list).toMatchObject({ origin: "generated", api_operation: "campaigns.list", usage: "tool campaigns list" })
    expect(handwritten?.origin).toBe("handwritten")
    expect(handwritten).not.toHaveProperty("api_operation")
  })

  it("builds the usage line from the arguments", () => {
    const send = flatten(describeProgram(program())).find(({ name }) => name === "send")
    expect(send?.usage).toBe("tool messages send <chat> [text]")
    expect(send?.arguments.map(({ name, variadic }) => [name, variadic])).toEqual([
      ["chat", false],
      ["text", true],
    ])
  })

  it("carries the labels: effects, state, examples, summary", () => {
    const commands = flatten(describeProgram(program()))
    const byName = (name: string) => commands.find((command) => command.name === name)

    expect(byName("send")).toMatchObject({ effects: SEND, examples: ["tool messages send 42 hello"] })
    expect(byName("legacy")?.state).toBe("deprecated")
    expect(byName("list")?.summary).toBe("list messages")
    expect(byName("list")).not.toHaveProperty("effects")
  })
})

describe("options", () => {
  const options = () => {
    const list = flatten(describeProgram(program())).find(({ path }) => path.join(" ") === "messages list")
    return new Map(list?.options.map((option) => [option.flags.split(" ")[0], option]))
  }

  it("says which options take a value, and separately which must be given", () => {
    expect(options().get("--limit")).toMatchObject({ takes_value: true, mandatory: false, default: "20" })
    expect(options().get("--token")).toMatchObject({ takes_value: true, mandatory: true, env: "TOOL_TOKEN" })
    expect(options().get("--offline")).toMatchObject({ takes_value: false, mandatory: false })
  })

  it("carries choices, conflicts and implied values", () => {
    expect(options().get("--sort")?.choices).toEqual(["new", "old"])
    expect(options().get("--offline")?.conflicts).toEqual(["online"])
    expect(options().get("--online")?.implies).toEqual({ "--refresh": true })
  })

  it("leaves hidden options out", () => {
    expect(options().has("--debug-wire")).toBe(false)
  })

  it("describes the global options of the root", () => {
    expect(describeOptions(program()).map(({ flags }) => flags)).toEqual(["--json"])
  })
})

describe("annotate", () => {
  it("merges repeated labels and returns the command for chaining", () => {
    const command = new Command("x")
    expect(annotate(command, { effects: SEND })).toBe(command)
    annotate(command, { state: "beta" })
    expect(metaOf(command)).toEqual({ effects: SEND, state: "beta" })
  })

  it("answers an empty label for a command nobody annotated", () => {
    expect(metaOf(new Command("y"))).toEqual({})
  })
})

describe("stepTargets", () => {
  it("names each command's effects and the snake_case names it takes, root options included", () => {
    const targets = stepTargets(program())
    expect(targets("messages send")).toEqual({ effects: SEND, names: ["chat", "text", "json"] })
    expect(targets("messages list")?.names).toEqual(
      expect.arrayContaining(["chat", "limit", "sort", "debug_wire", "json"]),
    )
    expect(targets("messages list")).not.toHaveProperty("effects")
    expect(targets("messages forward")).toBeUndefined()
  })

  it("names a group's options on the commands under it, and a negated option by its flag", () => {
    const root = new Command("tool").option("--no-input", "never prompt")
    const chats = root.command("chats").option("--account <name>", "which account")
    chats.command("list").option("--no-backup", "skip the backup")
    expect(stepTargets(root)("chats list")?.names).toEqual(["no_input", "account", "no_backup"])
  })
})

describe("hidden commands", () => {
  it("are not in the registry", () => {
    const root = new Command("tool")
    root.command("shown")
    root.addCommand(new Command("secret"), { hidden: true })
    expect(describeProgram(root).map(({ name }) => name)).toEqual(["shown"])
  })
})

const COMMON_TEXT = {
  banner: "",
  title: "Commands",
  intro: "",
  globalHeading: "Global options",
  globalIntro: "",
  mutates: "",
  exitHeading: "Exit codes",
  exitIntro: "",
  outro: "",
}

describe("commandsPage", () => {
  const page = () =>
    commandsPage({
      cli: "tool",
      commands: describeProgram(program()),
      options: describeOptions(program()),
      labels: COMMANDS_PAGE_LABELS.en,
      text: {
        banner: "<!-- generated -->",
        title: "Commands",
        intro: "Every command.",
        globalHeading: "Global options",
        globalIntro: "On any command.",
        mutates: "**Changes something.**",
        exitHeading: "Exit codes",
        exitIntro: "Branch on the code.",
        outro: "",
      },
    })

  it("writes every command at its depth, with usage, arguments, options and defaults", () => {
    const text = page()
    expect(text.startsWith("<!-- generated -->\n\n# Commands\n\nEvery command.\n\n## Global options")).toBe(true)
    expect(text).toContain("| `--json` | print JSON. |")
    expect(text).toContain(
      "### `tool messages list`\n\nlist the messages of one chat\n\n```sh\ntool messages list <chat> [options]\n```",
    )
    expect(text).toContain("| `chat` | required | chat id or name. |")
    expect(text).toContain("| `--limit <n>` | how many. Default: `20`. |")
    expect(text).toContain("### `tool messages send`\n\n\n\n**Changes something.**")
    expect(text).not.toContain("--debug-wire")
    expect(text.endsWith("| `1` | anything else |\n")).toBe(true)
  })

  it("labels a write that changes only this machine with its own line, or none", () => {
    const root = new Command("tool")
    annotate(root.command("send").description("send"), { effects: SEND })
    annotate(root.command("save").description("save"), { effects: { remote: "none", local: "write" } })
    const text = (mutatesLocal?: string) =>
      commandsPage({
        cli: "tool",
        commands: describeProgram(root),
        options: [],
        labels: COMMANDS_PAGE_LABELS.en,
        text: { ...COMMON_TEXT, mutates: "**Changes the service.**", ...(mutatesLocal ? { mutatesLocal } : {}) },
      })

    expect(text("**Changes this machine only.**")).toContain("## `tool send`\n\nsend\n\n**Changes the service.**")
    expect(text("**Changes this machine only.**")).toContain("## `tool save`\n\nsave\n\n**Changes this machine only.**")
    expect(text()).toContain("## `tool save`\n\nsave\n\n```sh")
    expect(describeProgram(root)[1]).toMatchObject({ effects: { remote: "none", local: "write" } })
  })

  it("keeps a pipe or a tilde from breaking its row, and lists the allowed values", () => {
    expect(page()).toContain("| `--sort <order>` | order. One of: `new`, `old`. |")
    const piped = commandsPage({
      cli: "t",
      commands: [],
      options: [{ flags: "--order <recent|name>", description: "a|b ~~x~~", takes_value: true, mandatory: false }],
      labels: COMMANDS_PAGE_LABELS.ru,
      text: {
        banner: "",
        title: "Команды",
        intro: "",
        globalHeading: "Общие опции",
        globalIntro: "",
        mutates: "",
        exitHeading: "Коды",
        exitIntro: "",
        outro: "",
      },
    })
    expect(piped).toContain("| `--order <recent\\|name>` | a\\|b \\~\\~x\\~\\~. |")
    expect(piped).toContain("| `0` | получилось |")
  })
})

describe("refuseJoinedPath", () => {
  const check =
    (...args: string[]) =>
    () =>
      refuseJoinedPath(program(), args)

  it("names the words to type when a command path came as one argument", () => {
    expect(check("messages list", "--help")).toThrow(
      expect.objectContaining({
        code: "validation_error",
        message: '"messages list" was given as one argument; run: tool messages list',
      }),
    )
    expect(check("messages", "list 42")).toThrow(/run: tool messages list 42/)
  })

  it("leaves separate words, a quoted value and an unknown word to the parser", () => {
    expect(check("messages", "list", "--help")).not.toThrow()
    expect(check("messages", "send", "42", "hello there")).not.toThrow()
    expect(check("work chats", "list")).not.toThrow()
  })
})

describe("commands document", () => {
  const about = { cli: "tool", version: "1.2.3", contract: 0 }

  it("writes the one shape every CLI prints for commands --json, and reads it back", () => {
    const document = commandsDocument(program(), about)

    expect(Object.keys(document)).toEqual([
      "cli",
      "version",
      "contract",
      "description",
      "global_options",
      "commands",
      "exit_codes",
    ])
    expect(document.exit_codes).toMatchObject({ ok: 0, internal_error: 1, validation_error: 2 })
    expect(parseCommandsDocument(JSON.parse(JSON.stringify(document)))).toEqual({ document })
  })

  it("says how long a command runs, and reads it back", () => {
    const root = new Command("tool")
    annotate(root.command("watch").description("until stopped"), { lifetime: "persistent" })
    annotate(root.command("login").description("asks a person"), { lifetime: "interactive" })
    annotate(root.command("sync").description("a long fetch"), { cooperative: true })
    root.command("show").description("bounded")
    const document = commandsDocument(root, about)
    const byName = (name: string) => document.commands.find((command) => command.name === name)

    expect(byName("watch")?.lifetime).toBe("persistent")
    expect(byName("login")?.lifetime).toBe("interactive")
    expect(byName("sync")?.cooperative).toBe(true)
    expect(byName("show")).not.toHaveProperty("lifetime")
    expect(parseCommandsDocument(JSON.parse(JSON.stringify(document)))).toEqual({ document })
  })

  it("keeps a command off MCP servers when it or a group above it says so", () => {
    const root = new Command("tool")
    const admin = annotate(root.command("admin").description("group"), { mcp: false })
    annotate(admin.command("reset").description("leaf under a group kept off"), { mcp: true })
    const tasks = root.command("tasks").description("group")
    annotate(tasks.command("purge").description("leaf kept off"), { mcp: false })
    tasks.command("list").description("left alone")
    const document = commandsDocument(root, about)
    const at = (...path: string[]) =>
      flatten(document.commands).find((command) => command.path.join(" ") === path.join(" "))

    expect(at("admin")?.mcp).toBe(false)
    expect(at("admin", "reset")?.mcp).toBe(false)
    expect(at("tasks", "purge")?.mcp).toBe(false)
    expect(at("tasks")).not.toHaveProperty("mcp")
    expect(at("tasks", "list")).not.toHaveProperty("mcp")
    expect(parseCommandsDocument(JSON.parse(JSON.stringify(document)))).toEqual({ document })
  })

  it("marks a command that cannot answer offline, and every command under a group marked so", () => {
    const root = new Command("tool")
    const members = annotate(root.command("members").description("group"), { offline: false })
    members.command("fetch").description("leaf under a group marked")
    const chats = root.command("chats").description("group")
    annotate(chats.command("inspect").description("leaf marked"), { offline: false })
    chats.command("list").description("left alone")
    const document = commandsDocument(root, about)
    const at = (...path: string[]) =>
      flatten(document.commands).find((command) => command.path.join(" ") === path.join(" "))

    expect(at("members")?.offline).toBe(false)
    expect(at("members", "fetch")?.offline).toBe(false)
    expect(at("chats", "inspect")?.offline).toBe(false)
    expect(at("chats")).not.toHaveProperty("offline")
    expect(at("chats", "list")).not.toHaveProperty("offline")
    expect(parseCommandsDocument(JSON.parse(JSON.stringify(document)))).toEqual({ document })
  })

  it("keeps an option off MCP tools when it says so, and only that option", () => {
    const root = new Command("tool").addOption(annotateOption(new Option("--unsafe", "global"), { mcp: false }))
    root
      .command("delete")
      .description("deletes")
      .addOption(annotateOption(new Option("--for-everyone", "for both sides"), { mcp: false }))
      .option("--yes", "skip the question")
    const document = commandsDocument(root, about)
    const [forEveryone, yes] = document.commands[0]?.options ?? []

    expect(document.global_options[0]?.mcp).toBe(false)
    expect(forEveryone?.mcp).toBe(false)
    expect(yes).not.toHaveProperty("mcp")
    expect(document.commands[0]).not.toHaveProperty("mcp")
    expect(parseCommandsDocument(JSON.parse(JSON.stringify(document)))).toEqual({ document })
  })

  it("carries a list's output entity and its query fields, without the fields' own checks", () => {
    const root = new Command("tool")
    annotate(root.command("tasks").command("list").argument("[query...]", "field:value terms"), {
      output: { entity: "task" },
      query: {
        entity: "task",
        backend: "sql",
        fields: [
          {
            name: "state",
            type: "enum",
            operators: ["term"],
            values: ["open"],
            example: "state:open",
            validate: () => {},
          },
        ],
      },
    })
    const document = commandsDocument(root, about)
    const [list] = document.commands[0]?.commands ?? []
    expect(list).toMatchObject({
      output: { entity: "task" },
      query: { entity: "task", backend: "sql", fields: [{ name: "state", example: "state:open" }] },
    })
    expect(list?.query?.fields[0]).not.toHaveProperty("validate")
    expect(parseCommandsDocument(JSON.parse(JSON.stringify(document)))).toEqual({ document })
  })

  it("refuses a document with keys of its own or without a version", () => {
    const { version: _, ...unversioned } = commandsDocument(program(), about)
    const { problems } = parseCommandsDocument({ ...unversioned, items: [] })

    expect(problems).toEqual([expect.stringMatching(/^version:/), expect.stringMatching(/^items:/)])
  })

  it("has a JSON Schema with the command tree under $defs", () => {
    const schema = commandsDocumentJsonSchema() as { $schema: string; $defs: Record<string, unknown> }

    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    expect(Object.keys(schema.$defs)).toEqual(["command"])
  })
})
