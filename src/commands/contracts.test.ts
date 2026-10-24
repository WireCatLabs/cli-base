import { Command } from "commander"
import { describe, expect, it, vi } from "vitest"
import { TASK_SHELL } from "../../test/contracts.fixture.js"
import {
  assertSharedContracts,
  customizeSharedCommand,
  hasSharedContract,
  overrideSharedContract,
  sharedCommand,
  sharedContractOverrides,
  sharedContracts,
} from "./contracts.js"
import { annotate } from "./registry.js"

const factory = sharedCommand(() =>
  annotate(new Command("show"), { effects: { local: "read", remote: "none" }, output: { entity: "task" } })
    .description("show one task")
    .option("--limit <n>", "maximum rows", "10")
    .action(() => {}),
)

describe("core-owned command contracts", () => {
  it.each(["description", "options", "output"])("refuses an implicit %s change before the action", async (field) => {
    const command = factory()
    const action = vi.fn()
    command.action(action)
    const root = new Command("tool").addCommand(command)
    if (field === "description") command.description("a different default")
    if (field === "options") command.option("--surprise", "a hidden divergence")
    if (field === "output") annotate(command, { output: { entity: "other_task" } })
    expect(() => assertSharedContracts(root)).toThrow("without an explicit override")
    await expect(root.parseAsync(["show"], { from: "user" })).rejects.toThrow("without an explicit override")
    expect(action).not.toHaveBeenCalled()
  })

  it("permits a precise reasoned edit and exposes exact before/after values", () => {
    const command = factory()
    const root = new Command("tool").addCommand(command)
    overrideSharedContract(command, "This provider can return at most five rows.", (one) => {
      const limit = one.options[0]
      if (limit) limit.default("5")
    })
    expect(() => assertSharedContracts(root)).not.toThrow()
    expect(sharedContractOverrides(root)).toMatchObject([
      {
        command: ["show"],
        field: "options",
        reason: "This provider can return at most five rows.",
        before: [{ default: "10" }],
        after: [{ default: "5" }],
      },
    ])
    command.options[0]?.default("6")
    expect(() => assertSharedContracts(root)).toThrow("without an explicit override")
  })

  it("keeps original defaults after an override and rejects silent child removal", () => {
    const group = sharedCommand(() => new Command("tasks").addCommand(factory()))()
    const root = new Command("tool").addCommand(group)
    overrideSharedContract(
      group.commands[0] as Command,
      "This provider uses its own stored task terminology.",
      (one) => {
        one.description("show stored task")
      },
    )
    expect(sharedContracts(root)["tasks show"]).toMatchObject({ description: "show one task" })
    Reflect.set(group, "commands", [])
    expect(() => assertSharedContracts(root)).toThrow("children")
  })

  it("records an explicit child removal while permitting new provider commands", () => {
    const group = sharedCommand(() => new Command("tasks").addCommand(factory()))()
    const root = new Command("tool").addCommand(group)
    overrideSharedContract(group, "This provider cannot read individual tasks from its API.", (one) => {
      Reflect.set(one, "commands", [])
    })
    group.addCommand(new Command("provider-only"))
    expect(() => assertSharedContracts(root)).not.toThrow()
    expect(sharedContractOverrides(root)).toContainEqual(
      expect.objectContaining({ field: "children", before: ["show"], after: [] }),
    )
  })

  it("binds a provider shell explicitly and protects its accepted grammar afterwards", () => {
    const source = sharedCommand(() => new Command("tasks").addCommand(factory()))()
    const adapted = customizeSharedCommand(
      source,
      "This provider reads imported task rows from an explicit source.",
      () =>
        new Command("tasks").addCommand(
          new Command("show")
            .description("show an imported task")
            .option("--source <account>", "explicit stored source"),
        ),
      TASK_SHELL,
    )
    const root = new Command("tool").addCommand(adapted)
    expect(sharedContracts(root)["tasks show"]).toMatchObject({ description: "show one task" })
    expect(sharedContractOverrides(root)).toContainEqual(
      expect.objectContaining({
        command: ["tasks", "show"],
        field: "description",
        before: "show one task",
        after: "show an imported task",
      }),
    )
    adapted.commands[0]?.option("--surprise", "undeclared variation")
    expect(() => assertSharedContracts(root)).toThrow("without an explicit override")
  })

  it("rejects stale, absent and widened shell declarations without installing guards", () => {
    const reason = "This provider reads imported task rows from an explicit source."
    const native = () =>
      new Command("tasks").addCommand(
        new Command("show").description("show an imported task").option("--source <account>", "explicit stored source"),
      )
    const reference = () => sharedCommand(() => new Command("tasks").addCommand(factory()))()
    const own = native()
    expect(() => customizeSharedCommand(reference(), reason, () => own, [])).toThrow("reviewed shared contract")
    expect(hasSharedContract(own)).toBe(false)
    const ownChild = own.commands[0]
    if (!ownChild) throw new Error("missing test child")
    expect(hasSharedContract(ownChild)).toBe(false)
    const changedCore = reference()
    const coreChild = changedCore.commands[0]
    if (!coreChild) throw new Error("missing reference child")
    overrideSharedContract(coreChild, "Core now exposes an additional standard flag.", (one) => {
      one.option("--new-default", "a new Core default")
    })
    expect(() => customizeSharedCommand(changedCore, reason, native, TASK_SHELL)).toThrow("reviewed shared contract")
    expect(() =>
      customizeSharedCommand(
        reference(),
        reason,
        () => native().option("--surprise", "an unreviewed provider option"),
        TASK_SHELL,
      ),
    ).toThrow("reviewed shared contract")
    expect(() => customizeSharedCommand(reference(), reason, native, [...TASK_SHELL, ...TASK_SHELL])).toThrow(
      "reviewed shared contract",
    )
  })

  it("cannot use provider composition to acknowledge an already changed inherited command", () => {
    const existing = factory().description("an implicit change")
    expect(() =>
      customizeSharedCommand(factory(), "This provider has a deliberate independent transport.", () => existing, []),
    ).toThrow("without an explicit override")
    expect(() =>
      customizeSharedCommand(
        new Command("show"),
        "This has no shared definition to inherit.",
        () => new Command("show"),
        [],
      ),
    ).toThrow("protected shared definition")
  })

  it("rejects retrospective, empty and unreasoned exemptions", () => {
    const changed = factory().description("already changed")
    expect(() => overrideSharedContract(changed, "Acknowledging an earlier accidental change.", () => {})).toThrow(
      "without an explicit override",
    )
    expect(() => overrideSharedContract(factory(), "", () => {})).toThrow("specific reason")
    expect(() => overrideSharedContract(factory(), "This edit makes no actual change.", () => {})).toThrow(
      "must change",
    )
    expect(() => overrideSharedContract(new Command("own"), "This was never a core-owned command.", () => {})).toThrow(
      "core-owned",
    )
  })

  it("keeps provider-only extensions possible while protecting inherited leaves", () => {
    const group = sharedCommand(() => new Command("tasks").addCommand(factory()))()
    const root = new Command("tool").addCommand(group)
    group.addCommand(new Command("provider-only"))
    expect(() => assertSharedContracts(root)).not.toThrow()
    group.commands[0]?.description("silently replaced")
    expect(() => assertSharedContracts(root)).toThrow("tasks show")
  })
})
