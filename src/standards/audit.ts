import * as v from "valibot"
import { LINT_SEVERITIES } from "./lint.js"
import { duplicates, parseRegistry, text, word } from "./registry.js"

/**
 * Whether a new cross-CLI divergence fails `cli-dev audit`, as a new lint violation does (`"new"`), or only shows in
 * the scorecard (`"never"`). Lint rules always block on a new violation.
 */
export const AUDIT_BLOCKS: "new" | "never" = "new"

const auditRuleSchema = v.strictObject({ id: word, severity: v.picklist(LINT_SEVERITIES), summary: text })
export type AuditRule = v.InferOutput<typeof auditRuleSchema>

export const defineAuditRules = (input: unknown): AuditRule[] =>
  parseRegistry("audit rules", v.array(auditRuleSchema), input, (rules) =>
    duplicates(rules.map((rule) => rule.id)).map((id) => `"${id}" is listed twice`),
  )

/** The rules that compare CLIs; each CLI is also judged alone by every lint rule. */
export const AUDIT_RULES: AuditRule[] = defineAuditRules([
  {
    id: "shared-command-contract",
    severity: "high",
    summary: "core-owned command definitions change only through exact, reasoned overrides",
  },
  {
    id: "required-root",
    severity: "high",
    summary: "every CLI has the required root commands",
  },
  {
    id: "same-path-contract",
    severity: "high",
    summary:
      "a command path two CLIs of a parity group share has the same options, value names, output and summary; a group that covers the whole tree has the same paths",
  },
  {
    id: "same-flag-meaning",
    severity: "high",
    summary: "a flag takes the same kind of value in every CLI",
  },
  {
    id: "same-entity-schema",
    severity: "high",
    summary: "an output entity two CLIs print has one JSON Schema",
  },
  {
    id: "same-error-reason",
    severity: "medium",
    summary: "an error reason is not a shared reason under another name, and one reason id has one code",
  },
])

const segment = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]*$/, "a command word"))

const parityGroupSchema = v.strictObject({
  name: word,
  /** CLI names as `commands --json` prints them in `cli`. */
  members: v.pipe(v.array(word), v.minLength(2)),
  /** `tree` compares every path; otherwise the root words whose paths are compared. */
  covers: v.union([v.literal("tree"), v.pipe(v.array(segment), v.minLength(1))]),
  /** Permanent differences, each with its reason; they count against the override budget of the group. */
  differences: v.array(
    v.strictObject({
      rule: word,
      target: text,
      expected: v.optional(text),
      reason: v.pipe(text, v.minLength(10, "say why, in a sentence")),
    }),
  ),
})

export type ParityGroup = v.InferOutput<typeof parityGroupSchema>

export const defineParityGroups = (input: unknown): ParityGroup[] =>
  parseRegistry("parity groups", v.array(parityGroupSchema), input, (groups) => [
    ...duplicates(groups.map((group) => group.name)).map((name) => `"${name}" is listed twice`),
    ...groups.flatMap((group) =>
      duplicates(group.differences.map((entry) => `${entry.rule} ${entry.target}`)).map(
        (both) => `${group.name}: "${both}" is listed twice`,
      ),
    ),
  ])

export const PARITY_GROUPS: ParityGroup[] = defineParityGroups([
  { name: "messengers", members: ["tg", "max"], covers: "tree", differences: [] },
  {
    name: "all",
    members: ["tg", "max", "memo", "drive", "zm", "wa", "gcal"],
    covers: ["commands", "doctor", "skill", "mcp", "upgrade", "search", "notes", "meetings"],
    differences: [],
  },
])

const requiredRootSchema = v.strictObject({ path: v.pipe(v.array(segment), v.minLength(1)), meaning: text })
export type RequiredRoot = v.InferOutput<typeof requiredRootSchema>

export const defineRequiredRoots = (input: unknown): RequiredRoot[] =>
  parseRegistry("required roots", v.array(requiredRootSchema), input, (roots) =>
    duplicates(roots.map((root) => root.path.join(" "))).map((path) => `"${path}" is listed twice`),
  )

export const REQUIRED_ROOTS: RequiredRoot[] = defineRequiredRoots([
  { path: ["commands"], meaning: "the command tree as JSON, what agents and this audit read" },
  { path: ["doctor"], meaning: "checks this machine and the profile, and says what to fix" },
  { path: ["skill", "show"], meaning: "prints the agent skill" },
  { path: ["skill", "install"], meaning: "installs the agent skill" },
  { path: ["mcp"], meaning: "the MCP server" },
  { path: ["upgrade"], meaning: "updates the CLI" },
])
