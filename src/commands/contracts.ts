import { isDeepStrictEqual } from "node:util"
import { Command } from "commander"
import { CliError } from "../errors.js"
import { type CommandInfo, describeProgram } from "./registry.js"

export interface SharedContractOverride {
  command: string[]
  field: string
  before: unknown
  after: unknown
  reason: string
}

type Contract = Omit<CommandInfo, "commands" | "usage" | "path"> & { aliases: string[]; children: string[] }
interface Protected {
  contract: Contract
  reference: Contract
  overrides: SharedContractOverride[]
  originalChildren: readonly Command[]
}
const protectedCommands = new WeakMap<Command, Protected>()

export const hasSharedContract = (command: Command): boolean => protectedCommands.has(command)

const snapshot = (command: Command): Contract => {
  const root = new Command("contract")
  const parent = command.parent
  root.addCommand(command)
  const described = describeProgram(root)[0]
  command.parent = parent
  if (!described) throw new Error("a hidden command cannot own a shared contract")
  const { commands: _, usage: __, path: ___, ...contract } = described
  return structuredClone({
    ...contract,
    aliases: [...command.aliases()],
    children: (protectedCommands.get(command)?.originalChildren ?? command.commands)
      .filter((child) => command.commands.includes(child) && !(child as Command & { _hidden?: boolean })._hidden)
      .map((child) => child.name()),
  })
}
const same = isDeepStrictEqual
const visit = (root: Command, fn: (command: Command) => void): void => {
  fn(root)
  for (const child of root.commands) visit(child, fn)
}
const pathOf = (command: Command): string[] => {
  const path = [command.name()]
  for (let at = command.parent; at?.parent; at = at.parent) path.unshift(at.name())
  return path
}
const differences = (before: Contract, after: Contract): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (field) => !same(before[field as keyof Contract], after[field as keyof Contract]),
  )

export const assertSharedContracts = (root: Command): void => {
  const changed: { command: string; fields: string[] }[] = []
  visit(root, (command) => {
    const protectedContract = protectedCommands.get(command)
    if (!protectedContract) return
    const fields = differences(protectedContract.contract, snapshot(command))
    if (fields.length) changed.push({ command: pathOf(command).join(" "), fields })
  })
  if (changed.length)
    throw new CliError(
      "configuration_error",
      `shared contract changed without an explicit override: ${changed.map((one) => `${one.command} (${one.fields.join(", ")})`).join("; ")}; use overrideSharedContract before changing it`,
      { reason: "contract.unacknowledged-override", contracts: changed },
    )
}

/** The callback names the deliberate edit; an already changed contract cannot be acknowledged after the fact. */
export const overrideSharedContract = <T extends Command>(
  command: T,
  reason: string,
  change: (command: T) => void,
): T => {
  if (reason.trim().length < 10) throw new Error("a shared contract override needs a specific reason")
  const protectedContract = protectedCommands.get(command)
  if (!protectedContract) throw new Error("only a core-owned command contract can be overridden")
  assertSharedContracts(command)
  const before = snapshot(command)
  change(command)
  const after = snapshot(command)
  const fields = differences(before, after)
  if (fields.length === 0) throw new Error("a shared contract override must change its named command")
  for (const field of fields)
    protectedContract.overrides.push({
      command: pathOf(command),
      field,
      before: before[field as keyof Contract] ?? null,
      after: after[field as keyof Contract] ?? null,
      reason: reason.trim(),
    })
  protectedContract.contract = after
  return command
}

export const sharedContractOverrides = (root: Command): SharedContractOverride[] => {
  assertSharedContracts(root)
  const result: SharedContractOverride[] = []
  visit(root, (command) => {
    for (const override of protectedCommands.get(command)?.overrides ?? [])
      result.push({ ...structuredClone(override), command: pathOf(command) })
  })
  return result
}

/** The original core definitions remain available independently of each host's accepted edits. */
export const sharedContracts = (root: Command): Record<string, unknown> => {
  assertSharedContracts(root)
  const result: Record<string, unknown> = {}
  visit(root, (command) => {
    const contract = protectedCommands.get(command)
    if (contract) result[pathOf(command).join(" ")] = structuredClone(contract.reference)
  })
  return result
}

/** Preserve the factory signature while recording the definition before host composition can edit it. */
export const sharedCommand =
  <Args extends unknown[], Result>(factory: (...args: Args) => Result) =>
  (...args: Args): Result => {
    const first = args[0]
    const before = new Set<Command>()
    if (first instanceof Command)
      visit(first, (command) => {
        before.add(command)
      })
    const result = factory(...args)
    const roots: Command[] = []
    if (result instanceof Command) roots.push(result)
    else if (Array.isArray(result))
      for (const item of result as unknown[]) if (item instanceof Command) roots.push(item)
    if (first instanceof Command)
      visit(first, (command) => {
        if (!before.has(command) && command.parent && before.has(command.parent) && !roots.includes(command))
          roots.push(command)
      })
    for (const shared of roots) {
      visit(shared, (command) => {
        const first = command.description().split("\n")[0] ?? ""
        if (!command.summary() && first.length > 80) command.summary(`${first.slice(0, 77).replace(/\s+\S*$/, "")}…`)
      })
      visit(shared, (command) => {
        if (!(command as Command & { _hidden?: boolean })._hidden && !protectedCommands.has(command))
          protectedCommands.set(command, {
            contract: snapshot(command),
            reference: snapshot(command),
            overrides: [],
            originalChildren: [...command.commands],
          })
      })
      shared.hook("preAction", () => {
        let root: Command = shared
        while (root.parent) root = root.parent
        assertSharedContracts(root)
      })
    }
    return result
  }

/** Bind a provider-owned shell before building it, retaining the shared defaults and every exact intentional edit. */
export const customizeSharedCommand = (reference: Command, reason: string, build: () => Command): Command => {
  if (reason.trim().length < 10) throw new Error("a shared contract override needs a specific reason")
  assertSharedContracts(reference)
  if (!hasSharedContract(reference)) throw new Error("a provider shell needs a protected shared definition")
  const command = build()
  assertSharedContracts(command)
  const adopt = (shared: Command, own: Command) => {
    const inherited = protectedCommands.get(shared)
    if (!inherited) return
    if (!protectedCommands.has(own)) {
      const originalChildren = own.commands.filter((child) => inherited.reference.children.includes(child.name()))
      const record: Protected = {
        reference: structuredClone(inherited.reference),
        contract: inherited.contract,
        overrides: structuredClone(inherited.overrides),
        originalChildren,
      }
      protectedCommands.set(own, record)
      const actual = snapshot(own)
      for (const field of differences(inherited.contract, actual))
        record.overrides.push({
          command: pathOf(own),
          field,
          before: inherited.contract[field as keyof Contract] ?? null,
          after: actual[field as keyof Contract] ?? null,
          reason: reason.trim(),
        })
      record.contract = actual
      own.hook("preAction", () => {
        let root = own
        while (root.parent) root = root.parent
        assertSharedContracts(root)
      })
    }
    for (const child of shared.commands) {
      const actual = own.commands.find((one) => one.name() === child.name())
      if (actual) adopt(child, actual)
    }
  }
  adopt(reference, command)
  assertSharedContracts(command)
  return command
}
