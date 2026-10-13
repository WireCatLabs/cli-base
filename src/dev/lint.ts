import type { CommandsDocument } from "../commands/document.js"
import type { CommandInfo, OptionInfo } from "../commands/index.js"
import { LINT_RULES, type LintRule, type Override } from "../standards/lint.js"
import type { Vocabulary } from "../standards/vocabulary.js"

export interface Violation {
  rule: string
  /** What the baseline and overrides name: `chats list`, `chats show <chat>`, `chats list --limit`, `--until`. */
  target: string
  message: string
}

const SUMMARY_LIMIT = 80

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const walk = (commands: readonly CommandInfo[]): CommandInfo[] =>
  commands.flatMap((one) => [one, ...walk(one.commands)])

const longName = (flags: string): string => flags.split(/[ ,|]+/).find((part) => part.startsWith("--")) ?? flags

/** A flag's kind of value: its value name, or `switch`. Two kinds under one name are two meanings. */
const kindOf = (option: OptionInfo): string => {
  if (!option.takesValue) return "switch"
  return option.flags.match(/[<[]([^>\]]+)[>\]]/)?.[1]?.toLowerCase() ?? "value"
}

const summaryOf = (command: CommandInfo): string => (command.summary ?? command.description.split("\n")[0] ?? "").trim()

const label = (command: CommandInfo): string => command.path.join(" ")

type Check = (document: CommandsDocument, vocabulary: Vocabulary) => Omit<Violation, "rule">[]

const CHECKS: Record<string, Check> = {
  "unknown-verb": (document, vocabulary) => {
    const allowed = new Set([
      ...vocabulary.verbs.map((entry) => entry.word),
      ...vocabulary.views.map((entry) => entry.word),
    ])
    const roots = new Set(vocabulary.roots.map((entry) => entry.word))
    return walk(document.commands)
      .filter((command) => command.commands.length === 0 && command.origin === "handwritten")
      .filter((command) => !allowed.has(command.name) && !(command.path.length === 1 && roots.has(command.name)))
      .map((command) => ({
        target: label(command),
        message: `"${command.name}" is not a verb or view noun in the vocabulary`,
      }))
  },
  "unknown-resource": (document, vocabulary) => {
    const nouns = new Set(vocabulary.nouns.map((entry) => entry.word))
    const roots = new Set(vocabulary.roots.map((entry) => entry.word))
    const verbs = new Set(vocabulary.verbs.map((entry) => entry.word))
    return walk(document.commands)
      .filter((command) => command.commands.length > 0 && command.origin === "handwritten")
      .filter((command) => !nouns.has(command.name) && !roots.has(command.name))
      .map((command) => ({
        target: label(command),
        message: verbs.has(command.name)
          ? `the group "${command.name}" is named with a verb; a group is a resource`
          : `"${command.name}" is not a resource in the vocabulary: a plural, a registered singular, or a root word`,
      }))
  },
  "flag-two-meanings": (document, vocabulary) => {
    const registered = new Map(
      vocabulary.flags.map((flag) => [flag.name, flag.value?.slice(1, -1).toLowerCase() ?? "switch"]),
    )
    const uses = new Map<string, Map<string, string[]>>()
    const note = (option: OptionInfo, where: string) => {
      const name = longName(option.flags)
      const kinds = uses.get(name) ?? new Map<string, string[]>()
      kinds.set(kindOf(option), [...(kinds.get(kindOf(option)) ?? []), where])
      uses.set(name, kinds)
    }
    for (const option of document.globalOptions) note(option, "every command")
    for (const command of walk(document.commands))
      if (command.origin === "handwritten") for (const option of command.options) note(option, label(command))
    const found: Omit<Violation, "rule">[] = []
    for (const [name, kinds] of [...uses].sort(([a], [b]) => byText(a, b))) {
      const expected = registered.get(name)
      const off = expected === undefined ? [] : [...kinds.keys()].filter((kind) => kind !== expected)
      if (kinds.size < 2 && off.length === 0) continue
      const described = [...kinds]
        .map(([kind, where]) => `${kind === "switch" ? "a switch" : `<${kind}>`} in ${where.slice(0, 3).join(", ")}`)
        .join("; ")
      found.push({
        target: name,
        message:
          expected === undefined
            ? `${name} has ${kinds.size} meanings: ${described}`
            : `${name} is ${expected === "switch" ? "a switch" : `<${expected}>`} in the vocabulary, but: ${described}`,
      })
    }
    return found
  },
  "missing-command-help": (document) =>
    walk(document.commands)
      .filter((command) => summaryOf(command) === "")
      .map((command) => ({ target: label(command), message: "no summary or description" })),
  "command-help-too-long": (document) =>
    walk(document.commands)
      .filter((command) => command.origin === "handwritten" && summaryOf(command).length > SUMMARY_LIMIT)
      .map((command) => ({
        target: label(command),
        message: `summary is ${summaryOf(command).length} characters; at most ${SUMMARY_LIMIT}`,
      })),
  "missing-argument-help": (document) =>
    walk(document.commands).flatMap((command) =>
      command.arguments
        .filter((argument) => argument.description.trim() === "")
        .map((argument) => ({ target: `${label(command)} <${argument.name}>`, message: "argument not described" })),
    ),
  "missing-option-help": (document) => [
    ...document.globalOptions
      .filter((option) => option.description.trim() === "")
      .map((option) => ({ target: longName(option.flags), message: "global option not described" })),
    ...walk(document.commands).flatMap((command) =>
      command.options
        .filter((option) => option.description.trim() === "")
        .map((option) => ({ target: `${label(command)} ${longName(option.flags)}`, message: "option not described" })),
    ),
  ],
}

export const lintRuleIds = (): string[] => Object.keys(CHECKS)

/** Every violation, one per rule and target, sorted. Generated commands keep the names of the API they mirror. */
export const lintCommands = (
  document: CommandsDocument,
  vocabulary: Vocabulary,
  rules: readonly LintRule[] = LINT_RULES,
): Violation[] => {
  const seen = new Set<string>()
  return rules.flatMap((rule) => {
    const check = CHECKS[rule.id]
    if (!check) throw new Error(`lint rule "${rule.id}" has no check`)
    return check(document, vocabulary)
      .filter(({ target }) => !seen.has(`${rule.id} ${target}`) && seen.add(`${rule.id} ${target}`))
      .map((found) => ({ rule: rule.id, ...found }))
      .sort((a, b) => byText(a.target, b.target))
  })
}

export interface Judgement {
  /** Not in the baseline and not overridden: these fail the run. */
  fresh: Violation[]
  baselined: number
  overridden: number
  /** Baseline or override entries with no violation left: the list only shrinks, so these fail too. */
  stale: { rule: string; target: string; in: "baseline" | "overrides" }[]
  /** Rule ids named by a baseline file or an override that no rule has. */
  unknownRules: string[]
  overBudget: boolean
}

export const judge = (
  violations: readonly Violation[],
  baseline: Readonly<Record<string, readonly string[]>>,
  overrides: readonly Override[],
  budget: number,
  rules: readonly LintRule[] = LINT_RULES,
): Judgement => {
  const ids = new Set(rules.map((rule) => rule.id))
  const key = (rule: string, target: string) => `${rule} ${target}`
  const overridden = new Set(overrides.map((entry) => key(entry.rule, entry.target)))
  const baselined = new Set(Object.entries(baseline).flatMap(([rule, targets]) => targets.map((t) => key(rule, t))))
  const found = new Set(violations.map((violation) => key(violation.rule, violation.target)))
  const open = violations.filter((violation) => !overridden.has(key(violation.rule, violation.target)))
  const fresh = open.filter((violation) => !baselined.has(key(violation.rule, violation.target)))

  return {
    fresh,
    baselined: open.length - fresh.length,
    overridden: violations.length - open.length,
    stale: [
      ...Object.entries(baseline).flatMap(([rule, targets]) =>
        targets
          .filter((target) => !found.has(key(rule, target)) || overridden.has(key(rule, target)))
          .map((target) => ({ rule, target, in: "baseline" as const })),
      ),
      ...overrides
        .filter((entry) => !found.has(key(entry.rule, entry.target)))
        .map((entry) => ({ rule: entry.rule, target: entry.target, in: "overrides" as const })),
    ],
    unknownRules: [
      ...new Set([...Object.keys(baseline), ...overrides.map((entry) => entry.rule)].filter((id) => !ids.has(id))),
    ].sort(),
    overBudget: overrides.length > budget,
  }
}

/** What `--write-baseline` writes: per rule, the targets no override covers. A rule with none gets no file. */
export const baselineOf = (
  violations: readonly Violation[],
  overrides: readonly Override[],
  rules: readonly LintRule[] = LINT_RULES,
): Record<string, string[]> => {
  const overridden = new Set(overrides.map((entry) => `${entry.rule} ${entry.target}`))
  return Object.fromEntries(
    rules.map((rule) => [
      rule.id,
      violations
        .filter((violation) => violation.rule === rule.id && !overridden.has(`${violation.rule} ${violation.target}`))
        .map((violation) => violation.target)
        .sort(),
    ]),
  )
}
