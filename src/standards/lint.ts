import * as v from "valibot"
import { duplicates, parseRegistry, text, word } from "./registry.js"

export const LINT_SEVERITIES = ["high", "medium", "low"] as const

const lintRuleSchema = v.strictObject({
  id: word,
  severity: v.picklist(LINT_SEVERITIES),
  /** What the rule looks at; a violation's target names one of these. */
  scope: v.picklist(["command", "group", "argument", "option", "flag", "key"]),
  summary: text,
})

export type LintRule = v.InferOutput<typeof lintRuleSchema>
export type LintSeverity = (typeof LINT_SEVERITIES)[number]

export const defineLintRules = (input: unknown): LintRule[] =>
  parseRegistry("lint rules", v.array(lintRuleSchema), input, (rules) =>
    duplicates(rules.map((rule) => rule.id)).map((id) => `"${id}" is listed twice`),
  )

/** Ids and severities follow the Azure CLI linter (`azdev linter`): a rule is named after what it finds. */
export const LINT_RULES: LintRule[] = defineLintRules([
  {
    id: "unknown-verb",
    severity: "high",
    scope: "command",
    summary:
      "a command's last word is a verb or view noun from the vocabulary; a top-level one may be a root word; under search, a resource or all",
  },
  {
    id: "unknown-resource",
    severity: "medium",
    scope: "group",
    summary: "a group is a resource from the vocabulary (plural, or a registered singular) or a root word",
  },
  {
    id: "flag-two-meanings",
    severity: "high",
    scope: "flag",
    summary: "a flag takes the same kind of value in every command, and the one the vocabulary gives it",
  },
  { id: "missing-command-help", severity: "high", scope: "command", summary: "every command has a summary" },
  {
    id: "command-help-too-long",
    severity: "low",
    scope: "command",
    summary: "a summary is at most 80 characters",
  },
  {
    id: "command-example-count",
    severity: "medium",
    scope: "command",
    summary: "a leaf command has one to three examples; generated commands are exempt",
  },
  {
    id: "faulty-help-example-parameters",
    severity: "high",
    scope: "command",
    summary: "an example starts with the tool, runs its own command, and gives only arguments and options it takes",
  },
  { id: "missing-argument-help", severity: "high", scope: "argument", summary: "every argument is described" },
  { id: "missing-option-help", severity: "high", scope: "option", summary: "every option is described" },
  {
    id: "key-casing",
    severity: "high",
    scope: "key",
    summary: "every key of a registered JSON Schema and of the commands document is snake_case",
  },
])

/** `lint/baseline/<rule-id>.json`: today's violations of one rule, by target. It may only shrink. */
export const baselineSchema = v.array(text)

/** `lint/overrides.json`: permanent exceptions, each with its reason, counted against a budget. */
export const overridesSchema = v.array(
  v.strictObject({ rule: word, target: text, reason: v.pipe(text, v.minLength(10, "say why, in a sentence")) }),
)

export type Override = v.InferOutput<typeof overridesSchema>[number]

/** What the schemas cannot say, so they stay convertible to JSON Schema: no entry twice. */
export const baselineProblems = (targets: readonly string[]): string[] =>
  duplicates(targets).map((target) => `"${target}" is listed twice`)

export const overridesProblems = (entries: readonly Override[]): string[] =>
  duplicates(entries.map((entry) => `${entry.rule} ${entry.target}`)).map((both) => `"${both}" is listed twice`)

export const OVERRIDE_BUDGET = 10
