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
      /**
       * `<clis> <path> <flag>`; with `absent` or `only`, only `<path> <flag>`: the CLI list is whoever else was compared.
       * same-entity-schema and same-error-reason name no CLI list either: `entity hit`, `reason profile.unknown: code`.
       */
      target: text,
      expected: v.optional(text),
      /** The CLI that lacks the path or flag by design; the rest must agree, so other CLIs joining do not stale it. */
      absent: v.optional(word),
      /** The one CLI that has the path or flag by design; every other CLI compared must lack it. */
      only: v.optional(word),
      reason: v.pipe(text, v.minLength(10, "say why, in a sentence")),
      /** Warns from 14 days before and fails 14 days after, as a lint override does. */
      review_after: v.optional(v.pipe(v.string(), v.isoDate("a date, YYYY-MM-DD"))),
    }),
  ),
})

export type ParityGroup = v.InferOutput<typeof parityGroupSchema>

export const defineParityGroups = (input: unknown): ParityGroup[] =>
  parseRegistry("parity groups", v.array(parityGroupSchema), input, (groups) => [
    ...duplicates(groups.map((group) => group.name)).map((name) => `"${name}" is listed twice`),
    ...groups.flatMap((group) => [
      ...duplicates(group.differences.map((entry) => `${entry.rule} ${entry.target}`)).map(
        (both) => `${group.name}: "${both}" is listed twice`,
      ),
      ...group.differences
        .filter((entry) => (entry.absent || entry.only) && entry.expected)
        .map(
          (entry) =>
            `${group.name}: "${entry.target}" has \`${entry.absent ? "absent" : "only"}\`, which measures the values itself; drop \`expected\``,
        ),
      ...group.differences
        .filter((entry) => entry.absent && entry.only)
        .map((entry) => `${group.name}: "${entry.target}" has both \`absent\` and \`only\`; keep one`),
    ]),
  ])

const MEMO_HAS_NO_PROFILES = [
  "mcp serve",
  "mcp revoke",
  "mcp server start",
  "mcp server status",
  "mcp server stop",
].map((path) => ({
  rule: "same-path-contract",
  target: `${path} --profiles`,
  absent: "memo",
  reason:
    "memo has no profiles: it reads other CLIs' stores and selects their accounts with --source and --account " +
    "(https://github.com/WireCatLabs/cli-base/issues/390)",
}))

const MEMO_DOCTOR_DEEP = {
  rule: "same-path-contract",
  target: "doctor --deep",
  only: "memo",
  reason:
    "memo's doctor --deep also checks its own store (cli-memo #672); cli-core's shared doctor leaves --deep to " +
    "each CLI, and no other CLI has one",
}

// The family audit measured these first in cli-base 0.98.0, as warnings; they fail since NEED-2578, and these were the
// differences on that day. The target names no CLI list: whoever shares the entity or reason, the difference holds.
const review = (rule: string, target: string, reason: string) => ({ rule, target, reason, review_after: "2026-11-27" })
const ENTITY = "same-entity-schema"
const REASON = "same-error-reason"
const MESSENGERS_SINCE_0_98 = [
  review(ENTITY, "entity contact_context", "max, tg and wa print it in different schemas (measured 2026-11-13)"),
  review(ENTITY, "entity contact_preparation", "max, tg and wa print it in different schemas (measured 2026-11-13)"),
  review(ENTITY, "entity linked_person", "max, tg and wa print it in different schemas (measured 2026-11-13)"),
]
const FAMILY_SINCE_0_98 = [
  review(ENTITY, "entity api_method", "b24's schema differs from drive and gcal's (measured 2026-11-13)"),
  review(ENTITY, "entity scheduled_job", "three schemas: b24, mail, memo / gcal / max, tg (measured 2026-11-13)"),
  review(ENTITY, "entity hit", "three schemas: b24, memo, zm / gcal / max, tg, wa (measured 2026-11-13)"),
  review(ENTITY, "entity deal", "b24's CRM deal and memo's differ (measured 2026-11-13)"),
  review(ENTITY, "entity lead", "b24's CRM lead and memo's differ (measured 2026-11-13)"),
  review(ENTITY, "entity product", "b24's CRM product and memo's differ (measured 2026-11-13)"),
  review(
    REASON,
    "reason ai.address-refused=model.address-refused",
    "one failure under two names; cli-core 0.650.0 keeps one",
  ),
  review(
    REASON,
    "reason profile.unknown: code",
    "b24 gives it not_found, drive validation_error (measured 2026-11-13)",
  ),
]

export const PARITY_GROUPS: ParityGroup[] = defineParityGroups([
  { name: "messengers", members: ["tg", "max"], covers: "tree", differences: MESSENGERS_SINCE_0_98 },
  {
    name: "all",
    members: ["tg", "max", "memo", "drive", "zm", "wa"],
    covers: ["commands", "doctor", "skill", "mcp", "upgrade", "search", "notes", "meetings"],
    differences: [...MEMO_HAS_NO_PROFILES, MEMO_DOCTOR_DEEP],
  },
  // mail's `search messages` is cli-core's mail search, not the messengers' command: --complete took their 20-odd
  // differences as inherited (https://github.com/WireCatLabs/cli-base/issues/390). mail is compared everywhere else
  // and moves back into "all" once its search is aligned with the messengers' or renamed.
  {
    name: "mail-shared",
    members: ["tg", "max", "memo", "drive", "zm", "wa", "mail"],
    covers: ["commands", "doctor", "skill", "mcp", "upgrade", "notes", "meetings"],
    differences: [...MEMO_HAS_NO_PROFILES, MEMO_DOCTOR_DEEP],
  },
  // gcal is compared on what it already shares with every CLI; doctor, mcp, search and skill wait until the published
  // CLIs agree there (https://github.com/WireCatLabs/cli-base/issues/390), then gcal moves back into "all".
  {
    name: "gcal-shared",
    members: ["tg", "max", "memo", "drive", "zm", "wa", "gcal"],
    covers: ["commands", "upgrade", "notes", "meetings"],
    differences: FAMILY_SINCE_0_98,
  },
  // bitrix24-cli's search is cli-core's CRM `search all`, and beeline-cli's and asterisk-cli's meetings take call
  // recordings, not zoom-cli's: they are compared on the root commands every CLI shares, the way gcal and mail are.
  // notion-cli joins here until its documents commands ship; then it moves next to drive.
  {
    name: "shared-roots",
    members: ["tg", "max", "memo", "drive", "zm", "wa", "b24", "beeline", "pbx", "notion"],
    covers: ["commands", "doctor", "skill", "mcp", "upgrade"],
    differences: [...MEMO_HAS_NO_PROFILES, MEMO_DOCTOR_DEEP],
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
