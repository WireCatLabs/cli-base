import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { AUDIT_RULES, LINT_RULES } from "../src/standards/index.ts"
import { knownChecks, readHandbook, standardsProblems } from "./standards-ids.ts"

const index = ["| Page | Area id | What |", "|---|---|---|", "| [Output](output.md) | `OUT` | output |"].join("\n")
const rule = (heading: string, enforced = "`flag-synonym` · `pnpm lint`") =>
  [heading, "", "- **Why:** because.", `- **Enforced by:** ${enforced}`, ""].join("\n")
const known = new Set(["flag-synonym", "pnpm lint"])
const check = (pages: Record<string, string>) =>
  standardsProblems({ index, pages: new Map(Object.entries(pages)) }, known)

describe("standards handbook check", () => {
  it("passes the handbook as it is in the repository", () => {
    const root = join(import.meta.dirname, "..")
    expect(standardsProblems(readHandbook(root), knownChecks(root, { LINT_RULES, AUDIT_RULES }))).toEqual([])
  })

  it("passes a page with no rules and rules that name known checks or say review only", () => {
    expect(check({ "output.md": "# Output\n" })).toEqual([])
    expect(
      check({ "output.md": [rule("### WC-OUT-1 · One"), rule("### WC-OUT-2 · Two", "review only")].join("\n") }),
    ).toEqual([])
  })

  it("ignores the rule template inside a code fence", () => {
    const template = ["```markdown", rule("### WC-OUT-1 · <rule>", "`writeData`"), "```"].join("\n")
    expect(check({ "output.md": [template, rule("### WC-OUT-1 · One")].join("\n") })).toEqual([])
    expect(check({ "output.md": [template, rule("### WC-OUT-1 · One", "`writeData`")].join("\n") })).toEqual([
      'output.md:11: "writeData" is not a known check — name one or say "review only"',
    ])
  })

  it("fails a duplicate id, a wrong area and a number out of order", () => {
    expect(
      check({
        "output.md": [rule("### WC-OUT-2 · Two"), rule("### WC-OUT-2 · Again"), rule("### WC-CMD-3 · Other")].join(
          "\n",
        ),
      }),
    ).toEqual([
      "output.md:6: WC-OUT-2 is also at output.md:1",
      "output.md:6: WC-OUT-2 comes after a higher number",
      "output.md:11: WC-CMD-3 is not in this page's area OUT",
    ])
  })

  it("fails an unknown check, an empty enforcer and a rule with no enforcer", () => {
    expect(
      check({
        "output.md": [
          rule("### WC-OUT-1 · One", "`writeData`"),
          rule("### WC-OUT-2 · Two", "the runtime"),
          "### WC-OUT-3 · Three\n",
        ].join("\n"),
      }),
    ).toEqual([
      'output.md:4: "writeData" is not a known check — name one or say "review only"',
      'output.md:9: "Enforced by" names no check — name one or say "review only"',
      'output.md: WC-OUT-3 has no "Enforced by" line',
    ])
  })

  it("fails a page the index does not link", () => {
    expect(check({ "output.md": "# Output\n", "extra.md": "# Extra\n" })).toEqual([
      "extra.md: not linked from the index",
    ])
  })

  it("knows lint and audit rules, workflows with their jobs, and package scripts", () => {
    const names = knownChecks(join(import.meta.dirname, ".."), { LINT_RULES, AUDIT_RULES })
    for (const name of ["flag-synonym", "required-root", "ci.yml", "changelog-guard.yml:guard", "pnpm docs:check"])
      expect(names.has(name)).toBe(true)
  })
})
