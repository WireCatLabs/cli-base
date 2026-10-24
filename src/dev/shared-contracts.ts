import type { CommandInfo } from "../commands/index.js"

export interface ContractEdit {
  command: readonly string[]
  field: string
  before: unknown
  after: unknown
  reason: string
}
const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stable(child)]),
    )
  return value
}
const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(stable(left ?? null)) === JSON.stringify(stable(right ?? null))
const FIELDS = new Set([
  "name",
  "summary",
  "description",
  "origin",
  "api_operation",
  "effects",
  "state",
  "partial",
  "lifetime",
  "reaches",
  "mcp",
  "offline",
  "cooperative",
  "examples",
  "output",
  "query",
  "runnable",
  "arguments",
  "options",
  "aliases",
  "children",
])

/** A baseline cannot replace a core definition: only an exact, reasoned edit changes its effective value. */
export const sharedContractProblems = (
  commands: readonly CommandInfo[],
  references: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  edits: readonly ContractEdit[] = [],
): { path: string; message: string }[] => {
  const effective = new Map<string, Record<string, unknown>>(
    Object.entries(references).map(([path, contract]) => [path, structuredClone(contract)]),
  )
  const problems: { path: string; message: string }[] = []
  for (const edit of edits) {
    const path = edit.command.join(" ")
    const contract = effective.get(path)
    if (
      !contract ||
      !FIELDS.has(edit.field) ||
      edit.reason.trim().length < 10 ||
      !same(contract[edit.field], edit.before) ||
      same(edit.before, edit.after)
    ) {
      problems.push({ path, message: `invalid or stale explicit override for ${edit.field}` })
      continue
    }
    if (edit.after === null) delete contract[edit.field]
    else contract[edit.field] = structuredClone(edit.after)
  }
  const walk = (items: readonly CommandInfo[], inherited: { mcp?: false; offline?: false }) => {
    for (const command of items) {
      const path = command.path.join(" ")
      const expected = effective.get(path)
      if (expected) {
        const { path: _, usage: __, commands: nested, ...fields } = command
        const original = references[path]?.children
        const actual = {
          ...fields,
          ...(Array.isArray(original)
            ? { children: nested.filter((child) => original.includes(child.name)).map((child) => child.name) }
            : {}),
        }
        const wanted: Record<string, unknown> = { ...expected, ...inherited }
        const changed = [...new Set([...Object.keys(actual), ...Object.keys(wanted)])].filter(
          (field) =>
            field !== "aliases" &&
            field !== "availability" &&
            !same((actual as Record<string, unknown>)[field], wanted[field]),
        )
        if (changed.length)
          problems.push({ path, message: `core contract differs without an exact override: ${changed.join(", ")}` })
        effective.delete(path)
      }
      walk(command.commands, {
        ...(inherited.mcp === false || expected?.mcp === false ? { mcp: false } : {}),
        ...(inherited.offline === false || expected?.offline === false ? { offline: false } : {}),
      })
    }
  }
  walk(commands, {})
  for (const path of effective.keys())
    problems.push({ path, message: "core contract names a command absent from discovery" })
  return problems
}
