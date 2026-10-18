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
    id: "missing-command-effects",
    severity: "high",
    scope: "command",
    summary: "every command that runs declares its effects: each leaf, and a group with an action of its own",
  },
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
  {
    id: "filter-flag",
    severity: "high",
    scope: "option",
    summary: "a command that changes nothing filters with its query, not with a flag named after a field of its entity",
  },
  {
    id: "option-role",
    severity: "high",
    scope: "option",
    summary: "every option has a role in the vocabulary; a filter has none, it is a query field",
  },
  {
    id: "list-without-query",
    severity: "medium",
    scope: "command",
    summary: "a list that answers with an entity takes a query over that entity's fields",
  },
  {
    id: "query-example",
    severity: "high",
    scope: "command",
    summary: "every query field's example, and every default term, parses and validates",
  },
  {
    id: "nullable-list",
    severity: "medium",
    scope: "key",
    summary: "a list in a registered JSON Schema is never null: known empty is `[]`, not known is absent",
  },
  {
    id: "flag-synonym",
    severity: "medium",
    scope: "option",
    summary: "an option is not another name for a vocabulary flag: `--max` and `--take` are `--limit`",
  },
  {
    id: "identifier-name",
    severity: "high",
    scope: "key",
    summary: "an identifier key is one from the glossary: `run_id`, never `execution_id` or `log_id`",
  },
  {
    id: "log-attribute-key",
    severity: "high",
    scope: "key",
    summary: "no log attribute key on the allow-list names message text, a token or a phone number",
  },
])

/** `lint/baseline/<rule-id>.json`: today's violations of one rule, by target. It may only shrink. */
export const baselineSchema = v.array(text)

/** `lint/overrides.json`: exceptions, each with its reason, who keeps it and when to look again; counted against a budget. */
export const overridesSchema = v.array(
  v.strictObject({
    rule: word,
    target: text,
    reason: v.pipe(text, v.minLength(10, "say why, in a sentence")),
    /** A GitHub handle or a team, `@leemour`. */
    owner: v.pipe(v.string(), v.regex(/^@[\w.-]+(\/[\w.-]+)?$/, "a GitHub handle or team, such as @leemour")),
    review_after: v.pipe(v.string(), v.isoDate("a date, YYYY-MM-DD")),
  }),
)

export type Override = v.InferOutput<typeof overridesSchema>[number]

/** What the schemas cannot say, so they stay convertible to JSON Schema: no entry twice. */
export const baselineProblems = (targets: readonly string[]): string[] =>
  duplicates(targets).map((target) => `"${target}" is listed twice`)

/** No entry twice, and none past its `review_after` on `today` (YYYY-MM-DD, the caller's clock). */
export const overridesProblems = (entries: readonly Override[], today: string): string[] => [
  ...duplicates(entries.map((entry) => `${entry.rule} ${entry.target}`)).map((both) => `"${both}" is listed twice`),
  ...entries
    .filter((entry) => entry.review_after < today)
    .map((entry) => `"${entry.rule} ${entry.target}" was due for review on ${entry.review_after}; ask ${entry.owner}`),
]

export const OVERRIDE_BUDGET = 10

/** More overrides of one rule than this, across every CLI, and the rule itself is due for review. */
export const OVERRIDE_RULE_REVIEW = 3

/** Rules overridden more than `OVERRIDE_RULE_REVIEW` times across the CLIs given, most first. */
export const rulesForReview = (lists: readonly (readonly Override[])[]): { rule: string; overrides: number }[] => {
  const counts = new Map<string, number>()
  for (const entry of lists.flat()) counts.set(entry.rule, (counts.get(entry.rule) ?? 0) + 1)
  return [...counts]
    .filter(([, count]) => count > OVERRIDE_RULE_REVIEW)
    .map(([rule, overrides]) => ({ rule, overrides }))
    .sort((a, b) => b.overrides - a.overrides || (a.rule < b.rule ? -1 : 1))
}
