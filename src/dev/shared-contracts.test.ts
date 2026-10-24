import { Command } from "commander"
import { describe, expect, it } from "vitest"
import { annotate, describeProgram } from "../commands/index.js"
import { type ContractEdit, sharedContractProblems } from "./shared-contracts.js"

const fixture = () => {
  const root = new Command("tool")
  const group = root.command("notes").description("stored notes")
  annotate(group.command("list").description("list notes"), { effects: { remote: "none", local: "read" } })
  const commands = describeProgram(root)
  const reference = Object.fromEntries(
    [commands[0], commands[0]?.commands[0]].map((command) => {
      if (!command) throw new Error("missing fixture")
      const { path, usage: _, commands: __, ...fields } = command
      return [path.join(" "), { ...fields, aliases: [] }]
    }),
  )
  return { root, group, commands, reference }
}

describe("core contract evidence", () => {
  it("compares original definitions independently of key ordering", () => {
    const { commands, reference } = fixture()
    expect(sharedContractProblems(commands, reference)).toEqual([])
    expect(sharedContractProblems(commands, Object.fromEntries(Object.entries(reference).reverse()))).toEqual([])
  })
  it("keeps runtime availability separate from the inherited command definition", () => {
    const { commands, reference } = fixture()
    const discovered = commands.map((command) => ({
      ...command,
      availability: { available: true },
      commands: command.commands.map((child) => ({
        ...child,
        availability: { available: false, reason: "owner permission required" },
      })),
    }))
    expect(sharedContractProblems(discovered, reference)).toEqual([])
    const child = discovered[0]?.commands[0]
    if (!child) throw new Error("missing fixture child")
    child.description = "an undeclared change"
    expect(sharedContractProblems(discovered, reference)[0]?.message).toContain("description")
  })
  it("requires an exact reasoned edit and rejects stale, vague and no-op edits", () => {
    const { root, group, reference } = fixture()
    group.commands[0]?.description("list imported notes")
    const commands = describeProgram(root)
    const edit: ContractEdit = {
      command: ["notes", "list"],
      field: "description",
      before: "list notes",
      after: "list imported notes",
      reason: "This provider stores imported notes only.",
    }
    expect(sharedContractProblems(commands, reference)).toHaveLength(1)
    expect(sharedContractProblems(commands, reference, [edit])).toEqual([])
    for (const patch of [
      { before: "old description" },
      { after: "list notes" },
      { reason: "why" },
      { field: "not_a_field" },
    ])
      expect(sharedContractProblems(commands, reference, [{ ...edit, ...patch }])[0]?.message).toContain(
        "invalid or stale",
      )
    expect(sharedContractProblems(commands, reference, [{ ...edit, after: "another value" }])[0]?.message).toContain(
      "differs",
    )
  })
  it("accepts inherited restrictions while preserving every child contract", () => {
    const { root, group, reference } = fixture()
    annotate(group, { mcp: false, offline: false })
    const edits: ContractEdit[] = ["mcp", "offline"].map((field) => ({
      command: ["notes"],
      field,
      before: null,
      after: false,
      reason: "This provider requires an authenticated connection.",
    }))
    expect(sharedContractProblems(describeProgram(root), reference, edits)).toEqual([])
    group.commands[0]?.description("silently changed")
    expect(sharedContractProblems(describeProgram(root), reference, edits)).toHaveLength(1)
  })
  it("reports removed commands even with an ordinary baseline", () => {
    const { commands, reference } = fixture()
    expect(sharedContractProblems([], reference)).toHaveLength(2)
    expect(
      sharedContractProblems(commands, reference, [
        {
          command: ["absent"],
          field: "description",
          before: null,
          after: "changed",
          reason: "A specific provider reason here.",
        },
      ])[0]?.message,
    ).toContain("invalid or stale")
  })
})
