import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Command } from "commander"
import { beforeEach, describe, expect, it } from "vitest"
import { commandsDocument } from "../commands/document.js"
import { annotate } from "../commands/index.js"
import { LINT_RULES } from "../standards/lint.js"
import { VOCABULARY } from "../standards/vocabulary.js"
import { judge, lintCommands, lintRuleIds } from "./lint.js"
import { type DevIo, main } from "./main.js"

const clean = (): Command => {
  const root = new Command("tool").description("a tool").option("--json", "print JSON")
  const chats = root.command("chats").description("chats in the messenger")
  chats.command("list").description("list chats").option("--limit <n>", "how many chats")
  chats.command("show").description("show one chat").argument("<chat>", "chat id or name")
  root.command("doctor").description("check this machine")
  const bot = root.command("bot").description("the bot account")
  annotate(bot.command("getMe").description(""), { origin: "generated" })
  return root
}

const lintOf = (root: Command) =>
  lintCommands(commandsDocument(root, { cli: "tool", version: "1.0.0", contract: 0 }), VOCABULARY)

const failing: Record<string, (root: Command) => void> = {
  "unknown-verb": (root) =>
    root.commands
      .find((one) => one.name() === "chats")
      ?.command("grab")
      .description("grab a chat"),
  "unknown-resource": (root) =>
    root.command("metadata").description("chat metadata").command("list").description("list it"),
  "flag-two-meanings": (root) =>
    root.commands
      .find((one) => one.name() === "chats")
      ?.command("export")
      .description("export")
      .option("--limit <time>", "until"),
  "missing-command-help": (root) => root.commands.find((one) => one.name() === "chats")?.command("delete"),
  "command-help-too-long": (root) => root.command("inbox").description("x".repeat(81)),
  "missing-argument-help": (root) =>
    root.commands
      .find((one) => one.name() === "chats")
      ?.command("leave")
      .description("leave a chat")
      .argument("<chat>"),
  "missing-option-help": (root) =>
    root.commands
      .find((one) => one.name() === "chats")
      ?.command("clear")
      .description("empty a chat")
      .option("--all"),
}

describe("lint rules", () => {
  it("has a check for every rule in the registry, and a failing fixture for each", () => {
    expect(lintRuleIds().sort()).toEqual(LINT_RULES.map((rule) => rule.id).sort())
    expect(Object.keys(failing).sort()).toEqual(lintRuleIds().sort())
  })

  it("passes a tree that follows the standard, generated commands keeping the API's names", () => {
    expect(lintOf(clean()).filter((found) => found.rule !== "missing-command-help")).toEqual([])
    expect(lintOf(clean())).toEqual([
      { rule: "missing-command-help", target: "bot getMe", message: "no summary or description" },
    ])
  })

  for (const [rule, breakIt] of Object.entries(failing))
    it(`fails ${rule}`, () => {
      const root = clean()
      breakIt(root)
      const before = new Set(lintOf(clean()).map((found) => `${found.rule} ${found.target}`))
      const fresh = lintOf(root).filter((found) => !before.has(`${found.rule} ${found.target}`))
      expect(fresh.map((found) => found.rule)).toEqual([rule])
    })

  it("says a group named with a verb is named with a verb", () => {
    const root = clean()
    root.command("link").description("links").command("list").description("list links")
    expect(lintOf(root).find((found) => found.target === "link")?.message).toMatch(/named with a verb/)
  })

  it("lists every kind a two-meaning flag takes", () => {
    const root = clean()
    root.command("tasks").description("tasks").command("add").description("add").option("--check <when>", "review then")
    root.command("upgrade").description("install a newer one").option("--check", "only say")
    expect(lintOf(root).find((found) => found.rule === "flag-two-meanings")).toEqual({
      rule: "flag-two-meanings",
      target: "--check",
      message: "--check has 2 meanings: <when> in tasks add; a switch in upgrade",
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
      [{ rule: "unknown-verb", target: "bot api", reason: "mirrors the official API" }],
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
        { rule: "unknown-verb", target: "chats grab", reason: "kept on purpose for now" },
        { rule: "unknown-verb", target: "chats fled", reason: "kept on purpose for now" },
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
      [{ rule: "unknown-verb", target: "bot api", reason: "mirrors the official API" }],
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

    expect(await lint("--write-baseline")).toBe(0)
    expect(existsSync(join(root, "lint/baseline/unknown-verb.json"))).toBe(false)
  })

  it("leaves overridden violations out of the baseline, and fails an override past the budget", async () => {
    document(broken())
    writeFileSync(
      join(root, "overrides.json"),
      JSON.stringify([{ rule: "unknown-verb", target: "chats grab", reason: "the messenger's own word for it" }]),
    )
    expect(await lint("--overrides", "overrides.json", "--write-baseline")).toBe(0)
    expect(existsSync(join(root, "lint/baseline/unknown-verb.json"))).toBe(false)
    expect(await lint("--overrides", "overrides.json", "--budget", "0")).toBe(1)
    expect(err).toContain("1 overrides; the budget is 0")
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
})
