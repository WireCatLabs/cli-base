import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Command } from "commander"
import * as v from "valibot"
import { beforeEach, describe, expect, it } from "vitest"
import { commandsDocument } from "../commands/document.js"
import { annotate, type CommandMeta } from "../commands/index.js"
import type { QueryRegistry } from "../query/fields.js"
import { LINT_RULES } from "../standards/lint.js"
import { logAttributesJsonSchema } from "../standards/log.js"
import { COMPACT_FLAG } from "../standards/output.js"
import { jsonSchemaOf } from "../standards/registry.js"
import { VOCABULARY } from "../standards/vocabulary.js"
import { baseSchemas, exampleWords, judge, type LintContext, lintCommands, lintRuleIds } from "./lint.js"
import { type DevIo, main, probeRunLog } from "./main.js"

const READS = { remote: "read", local: "none" } as const
const ran = <T extends Command>(command: T, meta: CommandMeta = {}): T => annotate(command, { effects: READS, ...meta })

const clean = (): Command => {
  const root = new Command("tool")
    .description("a tool")
    .option("--json", "print JSON")
    .option("--record", "keep this run")
    .option("--no-record", "do not keep it")
  const runs = root.command("runs").description("recorded runs")
  ran(runs.command("list").description("recorded runs, newest first").argument("[query...]", "field:value terms"), {
    examples: ["tool runs list"],
    query: { entity: "run", backend: "native", fields: [] },
  })
  ran(runs.command("show").description("one run").argument("<run>", "run id"), {
    examples: ["tool runs show 20261025T141828Z-tg-202e1f"],
  })
  const chats = root.command("chats").description("chats in the messenger")
  ran(
    chats
      .command("list")
      .description("list chats")
      .argument("[query...]", "field:value terms")
      .option("--limit <n>", "how many chats"),
    {
      examples: ["tool chats list", "tool work chats list --limit=5 --json"],
      query: { entity: "chat", backend: "native", fields: [] },
    },
  )
  ran(chats.command("show").description("show one chat").argument("<chat>", "chat id or name"), {
    examples: ["tool work chats show 'Kai Sample'"],
  })
  ran(root.command("doctor").description("check this machine"), { examples: ["tool doctor"] })
  const bot = root.command("bot").description("the bot account")
  ran(bot.command("getMe").description(""), { origin: "generated" })
  return root
}

const vocabulary = {
  ...VOCABULARY,
  flags: [
    ...VOCABULARY.flags,
    { name: "--json", type: "switch" as const, role: "output" as const, meaning: "print JSON" },
  ],
}

const lintOf = (root: Command, context: LintContext = {}) =>
  lintCommands(commandsDocument(root, { cli: "tool", version: "1.0.0", contract: 0 }), vocabulary, LINT_RULES, context)

const messageQuery: QueryRegistry = {
  entity: "message",
  backend: "sql",
  fields: [
    { name: "date", type: "time", operators: ["term", "range"], example: "date>=7d" },
    { name: "kind", type: "enum", operators: ["term"], values: ["group", "dialog"], example: "kind:group" },
  ],
  defaults: ["-kind:dialog"],
}

const KEPT = { owner: "@octocat", review_after: "2099-01-01" }

const chatsOf = (root: Command): Command => root.commands.find((one) => one.name() === "chats") ?? root

const failing: Record<string, (root: Command) => void> = {
  "missing-run-log": (root) => {
    const runs = root.commands.find((one) => one.name() === "runs")?.commands as Command[]
    runs.splice(
      runs.findIndex((one) => one.name() === "show"),
      1,
    )
  },
  "unknown-verb": (root) =>
    ran(chatsOf(root).command("grab").description("grab a chat"), { examples: ["tool chats grab"] }),
  "unknown-resource": (root) =>
    ran(
      root
        .command("unregistered-things")
        .description("an unregistered resource")
        .command("list")
        .description("list it"),
      {
        examples: ["tool unregistered-things list"],
        query: { entity: "chat", backend: "native", fields: [] },
      },
    ),
  "flag-two-meanings": (root) =>
    ran(chatsOf(root).command("export").description("export").option("--limit <time>", "until"), {
      examples: ["tool chats export --limit 2h"],
    }),
  "missing-command-effects": (root) =>
    annotate(chatsOf(root).command("move").description("move a chat to a folder"), {
      examples: ["tool chats move"],
    }),
  "missing-command-help": (root) => ran(chatsOf(root).command("delete"), { examples: ["tool chats delete"] }),
  "command-help-too-long": (root) =>
    ran(root.command("inbox").description("x".repeat(81)), { examples: ["tool inbox"] }),
  "command-example-count": (root) => ran(root.command("review").description("go through what needs you")),
  "faulty-help-example-parameters": (root) =>
    ran(root.command("watch").description("follow new events"), { examples: ["tool watch --follow"] }),
  "missing-argument-help": (root) =>
    ran(chatsOf(root).command("leave").description("leave a chat").argument("<chat>"), {
      examples: ["tool chats leave 42"],
    }),
  "key-casing": (root) =>
    ran(chatsOf(root).command("sync").description("sync chats"), {
      examples: ["tool chats sync"],
      ...({ operationId: "chats.sync" } as object),
    }),
  "missing-option-help": (root) =>
    ran(chatsOf(root).command("clear").description("empty a chat").option("--dry-run"), {
      examples: ["tool chats clear --dry-run"],
    }),
  "filter-flag": (root) =>
    ran(
      root
        .command("messages")
        .description("messages")
        .command("list")
        .description("list messages")
        .argument("[query...]", "field:value terms")
        .option("--since-time <time>", "since when"),
      { examples: ["tool messages list --since-time 2h"], output: { entity: "message" }, query: messageQuery },
    ),
  "flag-synonym": (root) =>
    ran(chatsOf(root).command("search").description("search chats").option("--take <n>", "how many"), {
      examples: ["tool chats search --take 5"],
    }),
  "option-role": (root) =>
    ran(chatsOf(root).command("pin").description("pin a chat").option("--unread", "only unread"), {
      examples: ["tool chats pin --unread"],
    }),
  "list-without-query": (root) =>
    ran(root.command("contacts").description("contacts").command("list").description("list contacts"), {
      examples: ["tool contacts list"],
      output: { entity: "contact" },
    }),
  "query-example": (root) =>
    ran(
      chatsOf(root).command("events").description("what happened in chats").argument("[query...]", "field:value terms"),
      {
        examples: ["tool chats events kind:group"],
        output: { entity: "message" },
        query: { ...messageQuery, defaults: ["kind:channel"] },
      },
    ),
}

describe("lint rules", () => {
  it("requires a list query even when its answer entity has not been declared", () => {
    const root = clean()
    const list = ran(
      root.command("recipients").description("recipients").command("list").description("list recipients"),
      {
        examples: ["tool recipients list"],
      },
    )
    expect(lintOf(root).filter((finding) => finding.rule === "list-without-query")).toEqual([
      { rule: "list-without-query", target: "recipients list", message: "list declares no query" },
    ])
    list.argument("[query...]", "field:value terms")
    annotate(list, { query: { entity: "recipient", backend: "native", fields: [] } })
    expect(lintOf(root).filter((finding) => finding.rule === "list-without-query")).toEqual([])
  })

  it("lets session list name every profile without a query, and still flags a deeper session list", () => {
    const root = clean()
    const session = root.command("session").description("sign-in")
    ran(session.command("list").description("list profiles"), {
      examples: ["tool session list"],
      output: { entity: "profile" },
    })
    ran(chatsOf(root).command("session").description("chat sessions").command("list").description("list sessions"), {
      examples: ["tool chats session list"],
      output: { entity: "session" },
    })
    expect(lintOf(root).filter((finding) => finding.rule === "list-without-query")).toEqual([
      { rule: "list-without-query", target: "chats session list", message: "list declares no query" },
    ])
  })

  it("has a check for every rule in the registry, and a failing fixture for each", () => {
    expect(lintRuleIds().sort()).toEqual(LINT_RULES.map((rule) => rule.id).sort())
    expect(Object.keys(failing).sort()).toEqual(
      lintRuleIds()
        .filter(
          (id) =>
            !["log-attribute-key", "nullable-list", "identifier-name", "raw-network", "undeclared-host"].includes(id),
        )
        .sort(),
    )
  })

  it("fails raw-network for a network module or the global fetch, and passes hostFetch and type imports", () => {
    const of = (text: string) =>
      lintOf(clean(), { network: { sources: [{ path: "src/a.ts", text }] } })
        .filter((one) => one.rule === "raw-network")
        .map((one) => one.target)
    expect(
      of(
        [
          'import { request } from "node:https"',
          'import axios from "axios"',
          "const ws = require('ws')",
          'const net = await import("net")',
          'export { Agent } from "undici/agent"',
          "const answer = await fetch(url)",
        ].join("\n"),
      ),
    ).toEqual([
      "src/a.ts axios",
      "src/a.ts fetch",
      "src/a.ts net",
      "src/a.ts node:https",
      "src/a.ts undici/agent",
      "src/a.ts ws",
    ])
    expect(of("const send = globalThis.fetch")).toEqual(["src/a.ts fetch"])
    expect(
      of(
        [
          'import type { IncomingMessage } from "node:http"',
          'import { hostFetch } from "@wirecat/cli-base/http"',
          "const fetch = hostFetch({ hosts: WCAT.hosts })",
          "await fetch(url)",
          "await client.fetch(url)",
          "const fake = { fetch: send as typeof globalThis.fetch }",
        ].join("\n"),
      ),
    ).toEqual([])
  })

  it("passes raw-network for a comment, a server that only listens and an isIP import", () => {
    const of = (text: string) =>
      lintOf(clean(), { network: { sources: [{ path: "src/a.ts", text }] } })
        .filter((one) => one.rule === "raw-network")
        .map((one) => one.target)
    expect(
      of(
        [
          " * A fetch (`remote: read`) keeps receiving",
          "// await fetch(url)",
          "const answer = await this.#fetch(url)",
          'import { createServer, type IncomingMessage } from "node:http"',
          'import { isIP as ipVersion } from "node:net"',
        ].join("\n"),
      ),
    ).toEqual([])
    expect(
      of(
        [
          'import { createServer, request } from "node:http"',
          'import { createConnection, isIP } from "node:net"',
          'import * as https from "node:https"',
        ].join("\n"),
      ),
    ).toEqual(["src/a.ts node:http", "src/a.ts node:https", "src/a.ts node:net"])
  })

  it("fails undeclared-host for a URL host the manifest does not declare, and skips without a declaration", () => {
    const text = [
      'const API = "https://api.acme.example/v1"',
      'const CDN = "https://img.cdn.acme.example/a.png"',
      'const LEAK = "https://collector.evil.dev/x"',
      "// see https://commented.evil.dev",
      'const DOCS = "https://docs.acme.dev/cli"',
      'const SCHEMA = "https://json-schema.org/draft/2020-12/schema"',
      'const SHAPES = "http://host:port or http://localhost:8080"',
    ].join("\n")
    const of = (hosts?: string[]) =>
      lintOf(clean(), {
        network: { sources: [{ path: "src/a.ts", text }], ...(hosts ? { hosts } : {}), docsHost: "docs.acme.dev" },
      }).filter((one) => one.rule === "undeclared-host")
    expect(of()).toEqual([])
    expect(of(["api.acme.example", "*.cdn.acme.example"])).toEqual([
      {
        rule: "undeclared-host",
        target: "collector.evil.dev",
        message:
          "named in src/a.ts but not in network.hosts: add it to `hosts` in the WCAT identity and run cli-dev manifest",
      },
    ])
  })

  it("fails nullable-list for a list that may be null, and passes cli-base's own schemas", () => {
    const of = (schemas?: Record<string, unknown>) =>
      lintOf(clean(), schemas ? { schemas } : {}).filter((one) => one.rule === "nullable-list")
    expect(of()).toEqual([])
    expect(
      of({
        chat: jsonSchemaOf(
          v.object({
            members: v.nullable(v.array(v.string())),
            tags: v.optional(v.array(v.string())),
            topic: v.nullable(v.string()),
          }),
        ),
        message: { type: "object", properties: { reactions: { type: ["array", "null"] } } },
      }),
    ).toEqual([
      expect.objectContaining({ target: "schema chat: members" }),
      expect.objectContaining({ target: "schema message: reactions" }),
    ])
  })

  it("fails identifier-name for a key the glossary names another way, in a schema or the document", () => {
    const of = (schemas?: Record<string, unknown>) =>
      lintOf(clean(), schemas ? { schemas } : {}).filter((one) => one.rule === "identifier-name")
    expect(of()).toEqual([])
    expect(
      of({ run: { type: "object", properties: { execution_id: { type: "string" }, run_id: { type: "string" } } } }),
    ).toEqual([
      {
        rule: "identifier-name",
        target: "schema run: execution_id",
        message: '"execution_id" is run_id; name it run_id',
      },
    ])
  })

  it("fails log-attribute-key for an allow-list naming content, and passes cli-base's own", () => {
    const document = commandsDocument(clean(), { cli: "tool", version: "1.0.0", contract: 0 })
    const of = (schemas?: Record<string, unknown>) =>
      lintCommands(document, VOCABULARY, LINT_RULES, schemas ? { schemas } : {}).filter(
        (one) => one.rule === "log-attribute-key",
      )
    expect(of()).toEqual([])
    expect(
      of({
        log_attributes: logAttributesJsonSchema([
          "messageId",
          "operationId",
          "providerError",
          "text",
          "errorMessage",
          "chatTitle",
          "accessToken",
          "phoneNumber",
        ]),
      }).map((one) => one.target),
    ).toEqual([
      "schema log_attributes: accessToken",
      "schema log_attributes: chatTitle",
      "schema log_attributes: errorMessage",
      "schema log_attributes: phoneNumber",
      "schema log_attributes: text",
    ])
    expect(
      lintCommands(document, VOCABULARY, LINT_RULES, {
        schemas: { log_attributes: logAttributesJsonSchema(["messageId"]) },
      }).filter((one) => one.rule === "key-casing"),
    ).toEqual([])
  })

  it("passes a tree that follows the standard, generated commands keeping the API's names", () => {
    expect(lintOf(clean()).filter((found) => found.rule !== "missing-command-help")).toEqual([])
    expect(lintOf(clean())).toEqual([
      { rule: "missing-command-help", target: "bot getMe", message: "no summary or description" },
    ])
  })

  it("passes the guided first run, setup --agent, as tg and wa have it", () => {
    const root = clean()
    ran(root.command("setup").description("log in, then install the agent skill").option("--agent <agent>", "x"), {
      examples: ["tool work setup", "tool work setup --agent codex"],
    })
    expect(lintOf(root)).toEqual(lintOf(clean()))
  })

  for (const [rule, breakIt] of Object.entries(failing))
    it(`fails ${rule}`, () => {
      const root = clean()
      breakIt(root)
      const before = new Set(lintOf(clean()).map((found) => `${found.rule} ${found.target}`))
      const fresh = lintOf(root).filter((found) => !before.has(`${found.rule} ${found.target}`))
      expect(fresh.map((found) => found.rule)).toEqual([rule])
    })

  it("asks effects of a group that runs on its own, not of one that only shows its help, and of generated commands", () => {
    const root = clean()
    annotate(
      root
        .command("inbox")
        .description("what needs you")
        .action(() => {}),
      { examples: ["tool inbox"] },
    )
    ran(
      root.commands
        .find((one) => one.name() === "inbox")
        ?.command("list")
        .description("list it") ?? root,
      {
        examples: ["tool inbox list"],
      },
    )
    annotate(
      root.commands
        .find((one) => one.name() === "bot")
        ?.command("getChat")
        .description("get a chat") ?? root,
      {
        origin: "generated",
      },
    )
    expect(lintOf(root).filter((found) => found.rule === "missing-command-effects")).toEqual([
      {
        rule: "missing-command-effects",
        target: "bot getChat",
        message: "no effects; without them it counts as a write",
      },
      { rule: "missing-command-effects", target: "inbox", message: "no effects; without them it counts as a write" },
    ])
  })

  it("checks every key of a registered schema and of the document as printed, but not a record's data keys", () => {
    const document = commandsDocument(clean(), { cli: "tool", version: "1.0.0", contract: 0 })
    const found = lintCommands(document, VOCABULARY, LINT_RULES, {
      raw: { ...document, exitCodes: document.exit_codes },
      schemas: {
        chat: {
          type: "object",
          properties: {
            unread_count: { type: "number" },
            lastMessage: { type: "object", properties: { sentAt: { type: "string" } } },
            labels: { type: "object", additionalProperties: { type: "string" } },
          },
        },
      },
    }).filter((one) => one.rule === "key-casing")
    expect(found.map((one) => one.target)).toEqual([
      "commands --json: exitCodes",
      "schema chat: lastMessage",
      "schema chat: lastMessage.sentAt",
    ])
  })

  it("checks the query tree's keys, nested clauses included", () => {
    const camel = JSON.parse(JSON.stringify(baseSchemas().query_ast).replace('"lower_inclusive"', '"lowerInclusive"'))
    const found = lintCommands(
      commandsDocument(clean(), { cli: "tool", version: "1.0.0", contract: 0 }),
      VOCABULARY,
      LINT_RULES,
      {
        schemas: { tree: camel },
      },
    ).filter((one) => one.rule === "key-casing")
    expect(found.map((one) => one.target)).toEqual(["schema tree: $defs.query_node.lowerInclusive"])
  })

  it("passes cli-base's own schemas and document", () => {
    expect(lintOf(clean()).filter((one) => one.rule === "key-casing")).toEqual([])
  })

  it("reads a list's entity fields from its schema, and leaves a scope flag alone", () => {
    const root = clean()
    ran(
      chatsOf(root)
        .command("events")
        .description("what happened in chats")
        .option("--kind <kind>", "which kind")
        .option("--before-id <id>", "older than")
        .option("--account <name>", "which account"),
      { examples: ["tool chats events"], output: { entity: "chat_event" } },
    )
    const scoped = {
      ...vocabulary,
      flags: [
        ...vocabulary.flags,
        {
          name: "--account",
          value: "<name>",
          type: "string" as const,
          role: "scope" as const,
          meaning: "which account",
        },
      ],
    }
    const found = lintCommands(
      commandsDocument(root, { cli: "tool", version: "1.0.0", contract: 0 }),
      scoped,
      LINT_RULES,
      {
        schemas: {
          chat_event: {
            type: "object",
            properties: { id: { type: "string" }, kind: { type: "string" }, account: { type: "string" } },
          },
        },
      },
    )
    expect(found.filter((one) => one.rule === "filter-flag").map((one) => `${one.target}: ${one.message}`)).toEqual([
      "chats events --before-id: filters by id; use the query",
      "chats events --kind: filters by kind; use the query",
    ])
  })

  it("distinguishes computation, output and paging controls from list filters and singleton targets", () => {
    const root = clean()
    ran(
      root
        .command("reports")
        .command("list")
        .option("--model <model>", "compute with this model")
        .option("--context <n>", "lines around a hit")
        .option("--offset-bytes <n>", "chunk start")
        .option("--timezone <zone>", "date interpretation"),
      { output: { entity: "report" } },
    )
    ran(root.command("files").command("show").option("--attachment <n>", "which one file"), {
      output: { entity: "file" },
    })
    const document = commandsDocument(root, { cli: "tool", version: "1", contract: 0 })
    const found = lintCommands(document, vocabulary, LINT_RULES, {
      schemas: {
        report: { type: "object", properties: { model: {}, context: {}, offset_bytes: {}, timezone: {} } },
        file: { type: "object", properties: { attachment: {} } },
      },
    })
    expect(found.filter((one) => one.rule === "filter-flag")).toEqual([])
  })

  it("does not infer a filter from a derived collection or an unrelated source time", () => {
    const root = clean()
    ran(
      root
        .command("agenda")
        .command("list")
        .option("--waiting <duration>", "threshold for a waiting group")
        .option("--since-time <time>", "meeting source window"),
      {
        output: { entity: "agenda" },
        query: {
          entity: "agenda",
          backend: "native",
          fields: [{ name: "project", type: "kw", operators: ["term"], example: "project:RES", native: true }],
        },
      },
    )
    const document = commandsDocument(root, { cli: "tool", version: "1", contract: 0 })
    expect(
      lintCommands(document, vocabulary, LINT_RULES, {
        schemas: {
          agenda: {
            type: "object",
            properties: {
              waiting: { type: "array", items: { type: "object" } },
              first_at: { type: "string", format: "date-time" },
            },
          },
        },
      }).filter((one) => one.rule === "filter-flag"),
    ).toEqual([])
  })

  it("passes a resource or all under search, at the root or under bot, and nothing else there", () => {
    const root = clean()
    const search = root.command("search").description("searches across resources")
    const botSearch = root.commands
      .find((one) => one.name() === "bot")
      ?.command("search")
      .description("bot searches")
    for (const [group, name] of [
      [search, "messages"],
      [search, "all"],
      [search, "grab"],
      [botSearch, "messages"],
    ] as const)
      ran(group?.command(name).description(`search ${name}`) ?? root, { examples: [`tool search ${name}`] })
    expect(lintOf(root).filter((found) => found.rule === "unknown-verb")).toEqual([
      { rule: "unknown-verb", target: "search grab", message: '"grab" is not a verb or view noun in the vocabulary' },
    ])
  })

  it("says why an example would not parse", () => {
    const root = clean()
    const add = (path: string, ...examples: string[]) => {
      const [group, name] = path.split(" ")
      const parent = root.commands.find((one) => one.name() === group) ?? root.command(group ?? "")
      ran(
        parent
          .command(name ?? "")
          .description("x")
          .argument("<chat>", "a chat")
          .option("--at-time <time>", "when"),
        {
          examples,
        },
      )
    }
    add(
      "chats pin",
      "other chats pin 1",
      "tool chats pin",
      "tool chats pin 1 2",
      "tool chats pin 1 --at-time",
      "tool chats pin 1 -x",
      "tool a b chats pin 1",
      "tool chats pin -- -1 --at-time=now --json",
    )
    expect(
      lintOf(root)
        .filter((found) => found.rule === "faulty-help-example-parameters")
        .map((found) => `${found.target} => ${found.message}`),
    ).toEqual([
      'chats pin: other chats pin 1 => does not start with "tool"',
      "chats pin: tool a b chats pin 1 => does not run chats pin",
      "chats pin: tool chats pin => chats pin needs 1 argument(s); the example gives 0",
      "chats pin: tool chats pin -- -1 --at-time=now --json => chats pin takes 1 argument(s); the example gives 3",
      "chats pin: tool chats pin 1 --at-time => --at-time needs a value",
      "chats pin: tool chats pin 1 -x => chats pin has no option -x",
      "chats pin: tool chats pin 1 2 => chats pin takes 1 argument(s); the example gives 2",
    ])
  })

  it("splits an example as a shell would", () => {
    expect(exampleWords(`memo context telegram:'Kai Sample' --body '{"a":1}' "say \\"hi\\"" a\\ b`)).toEqual([
      "memo",
      "context",
      "telegram:Kai Sample",
      "--body",
      '{"a":1}',
      'say "hi"',
      "a b",
    ])
  })

  it("says a group named with a verb is named with a verb", () => {
    const root = clean()
    root.command("link").description("links").command("list").description("list links")
    expect(lintOf(root).find((found) => found.target === "link")?.message).toMatch(/named with a verb/)
  })

  it("recognizes preparation communications scope, query and time flags without exemptions", () => {
    const root = clean()
    ran(
      root
        .command("meetings")
        .description("meetings")
        .command("prepare")
        .description("prepare context")
        .argument("<series-id>", "exact series")
        .option("--context-source <id=cursor>", "selected source and optional continuation")
        .option("--context-query <words>", "literal words")
        .option("--context-since-time <time>", "inclusive start")
        .option("--context-before-time <time>", "exclusive end"),
      {
        examples: ["tool meetings prepare 123 --context-source work --context-query launch"],
      },
    )
    expect(lintOf(root).filter((found) => ["option-role", "flag-two-meanings"].includes(found.rule))).toEqual([])
    expect(
      VOCABULARY.flags.filter((flag) => flag.name.startsWith("--context-")).map((flag) => [flag.name, flag.role]),
    ).toEqual(
      expect.arrayContaining([
        ["--context-source", "scope"],
        ["--context-query", "query"],
        ["--context-since-time", "target"],
        ["--context-before-time", "target"],
      ]),
    )
  })

  it("knows --compact as an output switch", () => {
    const root = clean()
    chatsOf(root).command("search").description("search chats").option(COMPACT_FLAG, "one line per chat")
    expect(lintOf(root).filter((found) => found.rule === "option-role")).toEqual([])
    expect(VOCABULARY.flags.find((flag) => flag.name === COMPACT_FLAG)).toMatchObject({
      role: "output",
      type: "switch",
    })
  })

  it("accepts the value names a vocabulary flag lists for other domains, and no others", () => {
    const root = clean()
    chatsOf(root).command("forward").description("forward").option("--to <chat>", "to a chat")
    root
      .command("mail")
      .description("mail")
      .command("send")
      .description("send")
      .option("--to <address>", "to an address")
    const only = (found: { rule: string }) => found.rule === "flag-two-meanings"
    expect(lintOf(root).filter(only)).toEqual([])
    root.command("notes").description("notes").command("add").description("add").option("--to <person>", "to a person")
    expect(lintOf(root).filter(only)[0]?.message).toMatch(/^--to is <chat> or <address> in the vocabulary, but:/)
  })

  it("lists every kind a two-meaning flag takes", () => {
    const root = clean()
    root
      .command("tasks")
      .description("tasks")
      .command("add")
      .description("add")
      .option("--review <when>", "review then")
    root.command("upgrade").description("install a newer one").option("--review", "only say")
    expect(lintOf(root).find((found) => found.rule === "flag-two-meanings")).toEqual({
      rule: "flag-two-meanings",
      target: "--review",
      message: "--review has 2 meanings: <when> in tasks add; a switch in upgrade",
    })
  })
})

describe("judge", () => {
  const violations = [
    { rule: "unknown-verb", target: "chats grab", message: "" },
    { rule: "unknown-verb", target: "bot api", message: "" },
  ]

  it("passes violations in the baseline or overridden, and counts each", () => {
    const verdict = judge(
      violations,
      { "unknown-verb": ["chats grab"] },
      [{ rule: "unknown-verb", target: "bot api", reason: "mirrors the official API", ...KEPT }],
      10,
    )
    expect(verdict).toMatchObject({
      fresh: [],
      baselined: 1,
      overridden: 1,
      stale: [],
      unknownRules: [],
      overBudget: false,
    })
  })

  it("fails a baseline entry with no violation, one an override covers, and an override with no violation", () => {
    const verdict = judge(
      violations.slice(0, 1),
      { "unknown-verb": ["chats grab", "chats gone"], "unknown-resource": ["bot"] },
      [
        { rule: "unknown-verb", target: "chats grab", reason: "kept on purpose for now", ...KEPT },
        { rule: "unknown-verb", target: "chats fled", reason: "kept on purpose for now", ...KEPT },
      ],
      10,
    )
    expect(verdict.stale).toEqual([
      { rule: "unknown-verb", target: "chats grab", in: "baseline" },
      { rule: "unknown-verb", target: "chats gone", in: "baseline" },
      { rule: "unknown-resource", target: "bot", in: "baseline" },
      { rule: "unknown-verb", target: "chats fled", in: "overrides" },
    ])
  })

  it("fails an unknown rule id and overrides over the budget", () => {
    const verdict = judge(
      violations,
      { "no-such-rule": [] },
      [{ rule: "unknown-verb", target: "bot api", reason: "mirrors the official API", ...KEPT }],
      0,
    )
    expect(verdict).toMatchObject({ unknownRules: ["no-such-rule"], overBudget: true })
  })
})

describe("cli-dev lint", () => {
  let root: string
  let out: string[]
  let err: string[]
  let io: DevIo

  const document = (tree: Command) => {
    writeFileSync(
      join(root, "commands.json"),
      JSON.stringify(commandsDocument(tree, { cli: "tool", version: "1.0.0", contract: 0 })),
    )
  }
  const lint = async (...args: string[]) => main(["lint", "--commands", "commands.json", ...args], io)
  const broken = () => {
    const tree = clean()
    for (const breakIt of Object.values(failing)) breakIt(tree)
    return tree
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cli-dev-lint-"))
    out = []
    err = []
    io = { cwd: root, out: (text) => out.push(text), err: (text) => err.push(text) }
  })

  it("fails a new violation, naming its severity, rule and target", async () => {
    document(broken())
    expect(await lint()).toBe(1)
    expect(err).toContain('high  unknown-verb  chats grab: "grab" is not a verb or view noun in the vocabulary')
  })

  it("writes one baseline file per rule with violations, then passes until one is fixed", async () => {
    document(broken())
    expect(await lint("--write-baseline")).toBe(0)
    expect(JSON.parse(readFileSync(join(root, "lint/baseline/unknown-verb.json"), "utf8"))).toEqual(["chats grab"])
    expect(existsSync(join(root, "lint/baseline/missing-command-help.json"))).toBe(true)
    expect(await lint()).toBe(0)
    expect(out).toContain("lint: ok")

    document(clean())
    expect(await lint()).toBe(1)
    expect(err).toContain(
      'stale baseline entry, fixed or overridden — remove it: lint/baseline/unknown-verb.json "chats grab"',
    )

    expect(await lint("--allow-stale")).toBe(0)
    expect(err).toContain(
      'warning  stale baseline entry, fixed or overridden — remove it: lint/baseline/unknown-verb.json "chats grab"',
    )

    expect(await lint("--write-baseline")).toBe(0)
    expect(existsSync(join(root, "lint/baseline/unknown-verb.json"))).toBe(false)
  })

  it("leaves overridden violations out of the baseline, and fails an override past the budget", async () => {
    document(broken())
    writeFileSync(
      join(root, "overrides.json"),
      JSON.stringify([
        { rule: "unknown-verb", target: "chats grab", reason: "the messenger's own word for it", ...KEPT },
      ]),
    )
    expect(await lint("--overrides", "overrides.json", "--write-baseline")).toBe(0)
    expect(existsSync(join(root, "lint/baseline/unknown-verb.json"))).toBe(false)
    expect(await lint("--overrides", "overrides.json", "--budget", "0")).toBe(1)
    expect(err).toContain("1 overrides; the budget is 0")
  })

  it("fails an override past its review date, naming who keeps it", async () => {
    const tree = clean()
    failing["unknown-verb"]?.(tree)
    document(tree)
    writeFileSync(
      join(root, "overrides.json"),
      JSON.stringify([
        {
          rule: "unknown-verb",
          target: "chats grab",
          reason: "the messenger's own word",
          owner: "@kai",
          review_after: "2026-10-01",
        },
      ]),
    )
    io.now = () => new Date("2026-10-14T12:00:00Z")
    expect(await lint("--overrides", "overrides.json")).toBe(1)
    expect(err).toContain('overrides.json: "unknown-verb chats grab" was due for review on 2026-10-01; ask @kai')
    io.now = () => new Date("2026-09-30T12:00:00Z")
    err.length = 0
    await lint("--overrides", "overrides.json")
    expect(err.join("\n")).not.toContain("due for review")
    expect(err).toContain("lint: 2 violations — 0 in the baseline, 1 overridden (budget 10), 1 new")
  })

  it("reads the CLI's own src, tests left out, and its hosts from the shipped manifest", async () => {
    document(clean())
    mkdirSync(join(root, "src/api"), { recursive: true })
    writeFileSync(join(root, "src/api/client.ts"), 'export const get = () => fetch("https://api.acme.dev/v1")\n')
    writeFileSync(join(root, "src/api/client.test.ts"), 'import { request } from "node:http"\n')
    mkdirSync(join(root, "src/testing"))
    writeFileSync(join(root, "src/testing/fake.ts"), 'import { createServer } from "node:http"\n')
    expect(await lint()).toBe(1)
    expect(err).toContain(
      "high  raw-network  src/api/client.ts fetch: calls the global fetch: use hostFetch from @wirecat/cli-base/http, which reaches only the declared hosts",
    )
    expect(err.join("\n")).not.toMatch(/client\.test\.ts|testing\/fake\.ts/)
    expect(err).toContain("undeclared-host: skipped, contracts/wirecat.json declares no network.hosts")

    mkdirSync(join(root, "contracts"))
    writeFileSync(join(root, "contracts/wirecat.json"), JSON.stringify({ network: { hosts: [] } }))
    err.length = 0
    expect(await lint()).toBe(1)
    expect(err.join("\n")).toContain("medium  undeclared-host  api.acme.dev: named in src/api/client.ts")
  })

  it("fails a baseline file named after no rule", async () => {
    document(clean())
    mkdirSync(join(root, "lint/baseline"), { recursive: true })
    writeFileSync(join(root, "lint/baseline/old-rule.json"), "[]")
    expect(await lint("--write-baseline")).toBe(1)
    expect(err).toContain('no lint rule "old-rule" (named in lint/baseline or lint/overrides.json)')
  })

  it("names a baseline file that is not JSON, and one that lists a target twice", async () => {
    document(clean())
    mkdirSync(join(root, "lint/baseline"), { recursive: true })
    writeFileSync(join(root, "lint/baseline/unknown-verb.json"), '["a", "a"]')
    expect(await lint()).toBe(1)
    expect(err).toContain('lint/baseline/unknown-verb.json: "a" is listed twice')
    writeFileSync(join(root, "lint/baseline/unknown-verb.json"), "[")
    expect(await lint()).toBe(2)
    expect(err.at(-1)).toMatch(/unknown-verb\.json: /)
  })

  it("refuses a commands document of another shape, saying what is wrong", async () => {
    writeFileSync(join(root, "commands.json"), JSON.stringify({ commands: [], options: [] }))
    expect(await lint()).toBe(2)
    expect(err[0]).toMatch(/not the shape cli-base's commandsDocument\(\) writes/)
    expect(err).toContain('  cli: Invalid key: Expected "cli" but received undefined')
  })

  it("runs the CLI itself with --cli, and needs exactly one source", async () => {
    const tree = JSON.stringify(commandsDocument(clean(), { cli: "tool", version: "1.0.0", contract: 0 }))
    writeFileSync(join(root, "bin.mjs"), `process.stdout.write(${JSON.stringify(tree)})\n`)
    expect(await main(["lint", "--cli", "bin.mjs", "--write-baseline"], io)).toBe(0)
    expect(await main(["lint"], io)).toBe(2)
    expect(err).toContain("lint needs one of --cli <bin> or --commands <file>")
  })

  it("warns, without failing, about a short command name and a CLI that does not answer --wcat-describe", async () => {
    const tree = JSON.stringify(commandsDocument(clean(), { cli: "tool", version: "1.0.0", contract: 0 }))
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@wirecat/tool-cli", bin: { tool: "bin.mjs" } }))
    writeFileSync(join(root, "bin.mjs"), `process.stdout.write(${JSON.stringify(tree)})\n`)
    expect(await main(["lint", "--cli", "bin.mjs", "--write-baseline"], io)).toBe(0)
    expect(err).toContain(
      'warning  wcat-bin-name  package.json "bin" tool: install the command as wcat-tool, so no other program on PATH has its name',
    )
    expect(err.some((line) => line.startsWith("warning  wcat-describe  --wcat-describe: "))).toBe(true)

    err.length = 0
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "@wirecat/tool-cli", bin: { "wcat-tool": "bin.mjs" } }),
    )
    writeFileSync(
      join(root, "bin.mjs"),
      `if (process.argv[2] === "--wcat-describe") process.stdout.write('{"wcat_describe":1,"name":"tool","version":"1.0.0","description":"d"}')
else process.stdout.write(${JSON.stringify(tree)})\n`,
    )
    expect(await main(["lint", "--cli", "bin.mjs"], io)).toBe(0)
    expect(err.filter((line) => line.startsWith("warning"))).toEqual([])
  })

  it("silences a wcat-bin-name warning through an override, and fails it once the name is gone", async () => {
    document(clean())
    const bin = (bin: Record<string, string>) =>
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@wirecat/tool-cli", bin }))
    bin({ tool: "bin.mjs", "wcat-tool": "bin.mjs" })
    writeFileSync(
      join(root, "overrides.json"),
      JSON.stringify([
        {
          rule: "wcat-bin-name",
          target: 'package.json "bin" tool',
          reason: "users still type the short name",
          ...KEPT,
        },
      ]),
    )
    expect(await lint("--overrides", "overrides.json", "--budget", "1", "--write-baseline")).toBe(0)
    expect(err.filter((line) => line.startsWith("warning"))).toEqual([])

    expect(await lint("--overrides", "overrides.json", "--budget", "0")).toBe(1)
    expect(err).toContain("1 overrides; the budget is 0")

    bin({ "wcat-tool": "bin.mjs" })
    expect(await lint("--overrides", "overrides.json")).toBe(1)
    expect(err).toContain('stale override, no such warning — remove it: wcat-bin-name "package.json "bin" tool"')
  })

  it("names an override entry that is not valid, and still applies the others", async () => {
    document(broken())
    writeFileSync(
      join(root, "overrides.json"),
      JSON.stringify([
        { rule: "unknown-verb", target: "chats grab", reason: "the messenger's own word for it", ...KEPT },
        { rule: "wcat-bin-name", target: 'package.json "bin" tool', reason: "short name", owner: "kai" },
      ]),
    )
    expect(await lint("--overrides", "overrides.json", "--write-baseline")).toBe(1)
    expect(existsSync(join(root, "lint/baseline/unknown-verb.json"))).toBe(false)
    expect(err).toContainEqual(expect.stringMatching(/^overrides\.json: entry 1 \(wcat-bin-name\) does not apply — /))
    expect(err.find((line) => line.startsWith("overrides.json: entry 1"))).toMatch(/owner: .*@octocat.*review_after/)
  })

  const fakeCli = (keeps: boolean) => {
    const tree = JSON.stringify(commandsDocument(clean(), { cli: "tool", version: "1.0.0", contract: 0 }))
    writeFileSync(
      join(root, "bin.mjs"),
      `import { existsSync, writeFileSync } from "node:fs"
const kept = process.env.HOME + "/kept"
const [first, second] = process.argv.slice(2)
if (first === "commands") process.stdout.write(${JSON.stringify(tree)})
else if (first === "runs" && second === "list")
  process.stdout.write(JSON.stringify({ items: existsSync(kept) ? [{ status: "failed" }] : [] }))
else {
  if (${keeps} && !process.env.XDG_STATE_HOME && !process.env.WIRECAT_STATE_DIR) writeFileSync(kept, "")
  process.exitCode = 2
}
`,
    )
  }

  it("passes missing-run-log when a failing run of the built CLI shows in its runs list", async () => {
    fakeCli(true)
    await main(["lint", "--cli", "bin.mjs"], io)
    expect(err.join("\n")).not.toContain("missing-run-log")
  })

  it("fails missing-run-log when the built CLI keeps no failed run", async () => {
    fakeCli(false)
    await main(["lint", "--cli", "bin.mjs"], io)
    expect(err.join("\n")).toContain("missing-run-log  runs: a failing command left no failed run")
  })

  it("probes the run log in a new empty home, with none of the caller's state variables", () => {
    fakeCli(true)
    const env = { PATH: process.env.PATH, XDG_STATE_HOME: "/owner/state", WIRECAT_STATE_DIR: "/owner/wirecat" }
    expect(probeRunLog(root, "bin.mjs", env)).toEqual({ kept: true })
  })
})
