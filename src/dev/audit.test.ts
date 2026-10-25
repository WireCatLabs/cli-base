import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Command } from "commander"
import * as v from "valibot"
import { beforeEach, describe, expect, it } from "vitest"
import { commandsDocument } from "../commands/document.js"
import { annotate } from "../commands/index.js"
import { AUDIT_RULES, PARITY_GROUPS, type ParityGroup, REQUIRED_ROOTS } from "../standards/audit.js"
import { listEnvelopeSchema } from "../standards/output.js"
import { VOCABULARY } from "../standards/vocabulary.js"
import { type AuditInput, type AuditOptions, auditClis, scorecardTable, snakeKeys } from "./audit.js"
import { type DevIo, main } from "./main.js"

const READS = { remote: "read", local: "none" } as const

const tool = (cli: string, build: (root: Command) => void = () => {}): Command => {
  const root = new Command(cli).description("a tool")
  for (const name of ["commands", "doctor", "mcp", "upgrade"])
    annotate(root.command(name).description(`the ${name} command`), { effects: READS, examples: [`${cli} ${name}`] })
  const skill = root.command("skill").description("the agent skill")
  for (const name of ["show", "install"])
    annotate(skill.command(name).description(`${name} the skill`), {
      effects: READS,
      examples: [`${cli} skill ${name}`],
    })
  build(root)
  return root
}

const inputOf = (root: Command, extra: Partial<AuditInput> = {}): AuditInput => {
  const document = commandsDocument(root, { cli: root.name(), version: "1.0.0", contract: 0 })
  return { document, raw: document, ...extra }
}

const groups: ParityGroup[] = [
  { name: "pair", members: ["a", "b"], covers: "tree", differences: [] },
  { name: "every", members: ["a", "b", "c"], covers: ["search", "notes"], differences: [] },
]

const options = (more: Partial<AuditOptions> = {}): AuditOptions => ({
  groups,
  roots: REQUIRED_ROOTS,
  vocabulary: VOCABULARY,
  baseline: {},
  blocks: "new",
  ...more,
})

const notes =
  (summary: string, flags: [string, string][] = [], output?: string) =>
  (root: Command) => {
    const command = root
      .command("notes")
      .description("notes")
      .command("list")
      .description(summary)
      .argument("[query...]", "field:value terms")
    for (const [flag, about] of flags) command.option(flag, about)
    annotate(command, {
      effects: READS,
      examples: [`${root.name()} notes list`],
      query: { entity: "note", backend: "native", fields: [] },
      ...(output ? { output: { entity: output } } : {}),
    })
  }

const cross = (inputs: AuditInput[], rule: string, more: Partial<AuditOptions> = {}) =>
  auditClis(inputs, options(more))
    .findings.filter((finding) => finding.rule === rule)
    .map((finding) => `${finding.target}: ${finding.message}`)

const clean = () => [tool("a", notes("list notes")), tool("b", notes("list notes")), tool("c", notes("list notes"))]

const failing: Record<string, () => AuditInput[]> = {
  "shared-command-contract": () => [
    inputOf(tool("a"), { contracts: { doctor: { name: "doctor", description: "a different doctor" } } }),
  ],
  "required-root": () => [inputOf(tool("a")), inputOf(new Command("b").description("no roots"))],
  "same-path-contract": () => [
    inputOf(tool("a", notes("list notes", [["--limit <n>", "how many"]]))),
    inputOf(tool("b", notes("list notes", [["--limit <count>", "how many"]]))),
  ],
  "same-flag-meaning": () => [
    inputOf(tool("a", (root) => root.option("--limit <n>", "how many"))),
    inputOf(tool("c", (root) => root.option("--limit", "limit it"))),
  ],
  "same-entity-schema": () => [
    inputOf(tool("a", notes("list notes", [], "note")), { schemas: { note: { type: "object" } } }),
    inputOf(tool("c", notes("list notes", [], "note")), { schemas: { note: { type: "array" } } }),
  ],
  "same-error-reason": () => [
    inputOf(tool("a"), {
      reasons: [{ reason: "note.missing", code: "not_found", message: "nothing found by that name", details: [] }],
    }),
    inputOf(tool("c"), { reasons: [] }),
  ],
}

describe("audit rules", () => {
  it("passes CLIs that agree, and fails a fixture for each cross-CLI rule", () => {
    expect(Object.keys(failing).sort()).toEqual(AUDIT_RULES.map((rule) => rule.id).sort())
    for (const rule of Object.keys(failing)) {
      expect(
        cross(
          clean().map((root) => inputOf(root)),
          rule,
        ),
        rule,
      ).toEqual([])
      expect(cross(failing[rule]?.() ?? [], rule).length, rule).toBeGreaterThan(0)
    }
  })

  it("accepts core-owned provider variants only while their exact inherited definitions remain intact", () => {
    const left = inputOf(tool("a", notes("list stored notes")))
    const right = inputOf(tool("b", notes("list imported notes")))
    const reference = (input: AuditInput) => {
      const command = input.document.commands.find((command) => command.name === "notes")?.commands[0]
      if (!command) throw new Error("missing fixture command")
      const { path: _, usage: __, commands: ___, ...fields } = command
      return { "notes list": fields }
    }
    left.contracts = reference(left)
    right.contracts = reference(right)
    expect(cross([left, right], "same-path-contract")).toHaveLength(1)
    expect(
      auditClis([left, right], options()).blocking.filter((finding) => finding.rule === "same-path-contract"),
    ).toEqual([])
    right.contracts = {
      ...right.contracts,
      "notes list": { ...right.contracts["notes list"], description: "the original imported notes" },
    }
    expect(
      auditClis([left, right], options()).blocking.some((finding) => finding.rule === "shared-command-contract"),
    ).toBe(true)
    expect(auditClis([left, right], options()).blocking.some((finding) => finding.rule === "same-path-contract")).toBe(
      true,
    )
  })

  it("names the missing root and the CLI that lacks it", () => {
    expect(cross([inputOf(tool("a")), inputOf(tool("b", () => {}).description("x"))], "required-root")).toEqual([])
    const bare = new Command("b").description("bare")
    expect(cross([inputOf(tool("a")), inputOf(bare)], "required-root")).toContain(
      'b skill install: no "skill install": installs the agent skill',
    )
  })

  it("compares options, output and summary of a shared path, ignoring the CLI's own name", () => {
    const found = cross(
      [
        inputOf(tool("a", notes("list notes in a", [["--limit <n>", "how many"]], "note"))),
        inputOf(tool("b", notes("list notes in b", [["--all", "every note"]], "memo"))),
      ],
      "same-path-contract",
    )
    expect(found).toEqual([
      "a+b notes list --all: a: absent, b: switch",
      "a+b notes list --limit: a: <n>, b: absent",
      "a+b notes list: output: a: note, b: memo",
    ])
  })

  it("holds wa to the shared roots of the other CLIs in the shipped groups", () => {
    const found = cross(
      [
        inputOf(tool("memo", notes("list notes", [["--limit <n>", "how many"]]))),
        inputOf(tool("wa", notes("list notes"))),
      ],
      "same-path-contract",
      { groups: PARITY_GROUPS },
    )
    expect(found).toEqual(["memo+wa notes list --limit: memo: <n>, wa: absent"])
  })

  it("reports a path one member of a whole-tree group lacks, and not one outside a group's roots or members", () => {
    const chats = (root: Command) => {
      annotate(root.command("chats").description("chats").command("list").description("list chats"), {
        effects: READS,
        examples: [`${root.name()} chats list`],
      })
    }
    expect(cross([inputOf(tool("a", chats)), inputOf(tool("b"))], "same-path-contract")).toEqual([
      "a+b chats: presence: only in a",
      "a+b chats list: presence: only in a",
    ])
    const summaries = (summary: string) => (root: Command) => {
      annotate(
        root
          .command("chats")
          .description(summary)
          .command("list")
          .description(summary)
          .argument("[query...]", "field:value terms"),
        {
          effects: READS,
          examples: [`${root.name()} chats list`],
        },
      )
    }
    expect(
      cross([inputOf(tool("a", summaries("one"))), inputOf(tool("c", summaries("two")))], "same-path-contract"),
    ).toEqual([])
    expect(cross([inputOf(tool("a")), inputOf(tool("b")), inputOf(tool("c", chats))], "same-path-contract")).toEqual([])
  })

  it("compares a flag's kind of value across CLIs, globals included", () => {
    expect(cross(failing["same-flag-meaning"]?.() ?? [], "same-flag-meaning")).toEqual([
      "a+c --limit: a: <n>, c: switch",
    ])
  })

  it("marks the schema and reason rules not measured for a CLI that gave no schemas or reasons", () => {
    const result = auditClis(failing["same-entity-schema"]?.() ?? [], options())
    const row = (cli: string, rule: string) => result.rows.find((one) => one.cli === cli && one.rule === rule)
    expect(row("a", "same-entity-schema")).toMatchObject({ measured: true, found: 1, new: 1 })
    expect(row("a", "same-error-reason")).toMatchObject({ measured: false })
  })

  it("finds a shared reason under another name, and one reason id with two codes", () => {
    const found = cross(
      [
        inputOf(tool("a"), {
          reasons: [
            { reason: "note.missing", code: "not_found", message: "Nothing found by that name", details: [] },
            { reason: "sync.failed", code: "provider_error", message: "the sync failed", details: [] },
          ],
        }),
        inputOf(tool("c"), {
          reasons: [{ reason: "sync.failed", code: "network_error", message: "the sync broke", details: [] }],
        }),
      ],
      "same-error-reason",
    )
    expect(found).toEqual([
      'a reason item.not-found=note.missing: one failure under 2 names: "nothing found by that name"',
      "a+c reason sync.failed: code: a: provider_error, c: network_error",
    ])
  })
})

describe("judging an audit", () => {
  const diverging = () => failing["same-path-contract"]?.() ?? []
  const target = "a+b notes list --limit"

  it("blocks contract drift even in a historical baseline, and counts resolved entries as fixed", () => {
    expect(auditClis(diverging(), options()).blocking.map((one) => one.target)).toContain(target)
    const baselined = auditClis(diverging(), options({ baseline: { "same-path-contract": [target] } }))
    expect(baselined.blocking.map((one) => one.target)).toContain(target)
    const fixed = auditClis(
      clean().map((root) => inputOf(root)),
      options({ baseline: { "same-path-contract": [target] } }),
    )
    expect(fixed.rows.find((one) => one.cli === "a" && one.rule === "same-path-contract")).toMatchObject({
      found: 0,
      fixed: 1,
    })
    expect(fixed.blocking).toEqual([])
  })

  it("leaves a baseline entry naming a CLI not in this run unjudged: not fixed, and kept on rewrite", () => {
    const wider = "a+b+c notes list --limit"
    const result = auditClis(diverging().slice(0, 2), options({ baseline: { "same-path-contract": [wider, target] } }))
    expect(result.rows.find((one) => one.cli === "a" && one.rule === "same-path-contract")).toMatchObject({
      baseline: 0,
      fixed: 0,
    })
    expect(result.nextBaseline["same-path-contract"]).toEqual([wider])
  })

  it("does not block on a cross-CLI divergence when blocking is off, but still on a lint violation", () => {
    const inputs = [
      ...diverging(),
      inputOf(
        tool("c", (root) =>
          annotate(root.command("grab").description("grab it"), { effects: READS, examples: ["c grab"] }),
        ),
      ),
    ]
    const rules = auditClis(inputs, options({ blocks: "never" })).blocking.map((one) => one.rule)
    expect(rules).toContain("unknown-verb")
    expect(rules).not.toContain("same-path-contract")
  })

  it("blocks only what names the CLI given with --for", () => {
    const inputs = [...diverging(), inputOf(tool("c"))]
    expect(
      auditClis(inputs, options({ only: "c" })).blocking.filter((one) => one.rule === "same-path-contract"),
    ).toEqual([])
  })

  it("leaves a declared difference out of the count, and fails a stale one", () => {
    const declared = groups.map((group) =>
      group.name === "pair"
        ? {
            ...group,
            differences: [
              {
                rule: "same-path-contract",
                target,
                expected: "a: <n>, b: <count>",
                reason: "the value names a count in b's provider",
              },
              { rule: "same-path-contract", target: "a+b gone", reason: "a divergence fixed long ago" },
            ],
          }
        : group,
    )
    const result = auditClis(diverging(), options({ groups: declared }))
    expect(result.blocking.map((one) => one.target)).not.toContain(target)
    expect(result.rows.find((one) => one.cli === "a" && one.rule === "same-path-contract")).toMatchObject({
      overridden: 1,
    })
    expect(result.problems).toContain(
      "stale difference in pair, no such divergence — remove it: same-path-contract a+b gone",
    )
  })

  it("judges a CLI's lint rules by its own lint folder when given", () => {
    const grab = tool("a", (root) =>
      annotate(root.command("grab").description("grab it"), { effects: READS, examples: ["a grab"] }),
    )
    const own = { baseline: { "unknown-verb": ["grab"] }, overrides: [], budget: 10 }
    const result = auditClis([inputOf(grab, { lint: own }), inputOf(tool("b"))], options())
    expect(result.rows.find((one) => one.cli === "a" && one.rule === "unknown-verb")).toMatchObject({
      baseline: 1,
      new: 0,
    })
    expect(result.nextBaseline["unknown-verb"]).toEqual([])
  })

  it("reads a camelCase document from a CLI on an older cli-base, and key-casing reports it", () => {
    const document = commandsDocument(tool("a"), { cli: "a", version: "1.0.0", contract: 0 })
    const camel = JSON.parse(
      JSON.stringify(document)
        .replaceAll('"global_options"', '"globalOptions"')
        .replaceAll('"takes_value"', '"takesValue"')
        .replaceAll('"exit_codes"', '"exitCodes"'),
    )
    expect(snakeKeys(camel)).toEqual(snakeKeys(document))
    const result = auditClis([{ document, raw: camel }, inputOf(tool("b"))], options())
    expect(result.findings.filter((one) => one.rule === "key-casing").map((one) => one.target)).toContain(
      "a: commands --json: globalOptions",
    )
  })

  it("prints the scorecard as a table: lines with findings or not measured, and a total per CLI", () => {
    const result = auditClis(failing["same-path-contract"]?.() ?? [], options())
    expect(
      scorecardTable(result.rows.filter((row) => !row.rule.startsWith("option") && row.rule !== "key-casing")),
    ).toMatchInlineSnapshot(`
      "cli  rule                     found  baseline  overridden  new  fixed
      a    shared-command-contract    n/a       n/a         n/a  n/a    n/a
      a    same-path-contract           1         0           0    1      0
      a    same-flag-meaning            1         0           0    1      0
      a    same-entity-schema         n/a       n/a         n/a  n/a    n/a
      a    same-error-reason          n/a       n/a         n/a  n/a    n/a
      b    flag-two-meanings            1         0           0    1      0
      b    shared-command-contract    n/a       n/a         n/a  n/a    n/a
      b    same-path-contract           1         0           0    1      0
      b    same-flag-meaning            1         0           0    1      0
      b    same-entity-schema         n/a       n/a         n/a  n/a    n/a
      b    same-error-reason          n/a       n/a         n/a  n/a    n/a
      a    total                        2         0           0    2      0
      b    total                        3         0           0    3      0"
    `)
  })
})

describe("cli-dev audit", () => {
  let root: string
  let out: string[]
  let err: string[]
  let io: DevIo

  const write = (name: string, tree: Command) =>
    writeFileSync(
      join(root, name),
      JSON.stringify(commandsDocument(tree, { cli: tree.name(), version: "1.0.0", contract: 0 })),
    )
  const audit = (...args: string[]) => main(["audit", "--commands", "tg.json", "--commands", "max.json", ...args], io)

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cli-dev-audit-"))
    out = []
    err = []
    io = { cwd: root, out: (text) => out.push(text), err: (text) => err.push(text) }
    write("tg.json", tool("tg", notes("list notes", [["--limit <n>", "how many"]])))
    write("max.json", tool("max", notes("list notes", [["--limit <count>", "how many"]])))
  })

  it("cannot bless contract drift by writing a baseline", async () => {
    expect(await audit()).toBe(1)
    expect(err.join("\n")).toContain("new  same-path-contract  max+tg notes list --limit: max: <count>, tg: <n>")
    expect(await audit("--write-baseline")).toBe(0)
    expect(await audit()).toBe(1)
  })

  it("compares the CLIs by the parity groups of a --groups file, and --differences adds to them", async () => {
    write("max.json", tool("max", notes("list the notes", [["--limit <n>", "how many"]])))
    writeFileSync(
      join(root, "groups.json"),
      JSON.stringify([{ name: "outside", members: ["tg", "max"], covers: ["notes"], differences: [] }]),
    )
    writeFileSync(
      join(root, "differences.json"),
      JSON.stringify([
        {
          group: "outside",
          rule: "same-path-contract",
          target: "max+tg notes list: summary",
          expected: 'max: "list the notes", tg: "list notes"',
          reason: "the two tools word the summary differently on purpose",
        },
      ]),
    )
    expect(await audit("--groups", "groups.json")).toBe(1)
    expect(err.join("\n")).toContain("new  same-path-contract  max+tg notes list: summary")
    expect(await audit("--groups", "groups.json", "--differences", "differences.json")).toBe(0)
    expect(await audit("--differences", "differences.json")).toBe(2)
    expect(err.at(-1)).toBe("differences.json: unknown group outside")
  })

  it("lists --groups in its help", async () => {
    expect(await main(["audit", "--help"], io)).toBe(0)
    expect(out.join("\n")).toContain("--groups <file>")
  })

  it("refuses a --groups file that is not a list of parity groups", async () => {
    writeFileSync(join(root, "groups.json"), JSON.stringify([{ name: "alone", members: ["tg"], covers: "tree" }]))
    expect(await audit("--groups", "groups.json")).toBe(2)
    expect(err.at(-1)).toMatch(/^groups\.json: .*members/)
  })

  it("requires both schemas and reasons for a complete file-based audit", async () => {
    expect(await audit("--complete")).toBe(1)
    expect(err.join("\n")).toContain("complete audit needs nonempty entity schemas")
    expect(err.join("\n")).toContain("complete audit needs declared error reasons")
  })

  it("measures complete runtime evidence and refuses an unowned required root", async () => {
    const binary = (cli: string, omitDoctor = false) => {
      const document = inputOf(tool(cli)).document
      const contracts: Record<string, unknown> = {}
      const capture = (commands: Readonly<typeof document.commands>) => {
        for (const command of commands) {
          const { path, usage: _, commands: children, ...contract } = command
          if (!omitDoctor || path.join(" ") !== "doctor") contracts[path.join(" ")] = contract
          capture(children)
        }
      }
      capture(document.commands)
      const evidence = {
        contracts,
        schemas: { fixture: { type: "object" } },
        reasons: [
          { reason: "fixture.invalid", code: "validation_error", message: "invalid fixture request", details: [] },
        ],
      }
      const file = join(root, cli + ".mjs")
      writeFileSync(
        file,
        `process.stdout.write(JSON.stringify(process.argv.includes("info") ? ${JSON.stringify(evidence)} : ${JSON.stringify(document)}))`,
      )
      return file
    }
    const left = binary("tg"),
      right = binary("max")
    await main(["audit", "--cli", left, "--cli", right, "--complete", "--json"], io)
    expect(err.join("\n")).not.toContain("complete audit needs")
    const rows = JSON.parse(out.join("")).items as { rule: string; measured: boolean; new: number }[]
    expect(
      rows
        .filter((row) => ["shared-command-contract", "same-entity-schema", "same-error-reason"].includes(row.rule))
        .every((row) => row.measured && row.new === 0),
    ).toBe(true)
    out.length = 0
    err.length = 0
    binary("max", true)
    expect(await main(["audit", "--cli", left, "--cli", right, "--complete"], io)).toBe(1)
    expect(err.join("\n")).toContain("complete audit needs an inherited contract reference for doctor")
  })

  it("prints the scorecard as the list envelope with --json", async () => {
    await audit("--json")
    const row = v.strictObject({
      cli: v.string(),
      rule: v.string(),
      measured: v.boolean(),
      found: v.number(),
      baseline: v.number(),
      overridden: v.number(),
      new: v.number(),
      fixed: v.number(),
      new_targets: v.array(v.string()),
    })
    const envelope = v.parse(listEnvelopeSchema(row), JSON.parse(out.join("")))
    expect(envelope.items.find((one) => one.cli === "tg" && one.rule === "same-path-contract")).toMatchObject({
      found: 1,
      new: 1,
    })
  })

  it("needs two CLIs, and refuses an input for a CLI it does not audit", async () => {
    expect(await main(["audit", "--commands", "tg.json"], io)).toBe(2)
    expect(err).toContain("audit needs two or more CLIs: --cli <bin> or --commands <file>, repeated")
    mkdirSync(join(root, "lint"))
    expect(await audit("--lint", "zm=lint", "--write-baseline")).toBe(1)
    expect(err).toContain("--lint names zm, which is not audited")
    expect(await audit("--schemas", "tg")).toBe(2)
    expect(err.at(-1)).toBe('--schemas takes <cli>=<path>, not "tg"')
  })
})
