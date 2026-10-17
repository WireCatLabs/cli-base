import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { AUDIT_RULES, LINT_RULES } from "../src/standards/index.ts"
import { knownChecks, OTHER_REPOSITORIES, readHandbook, standardsProblems } from "./standards-ids.ts"

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

  it("accepts a check in another repository in the form `<repo>: <check>`", () => {
    const enforced = "`cli-core: pnpm parity:check` · `cli-testing: cli-contract help` · `<app>: pnpm contracts:check`"
    expect(check({ "output.md": rule("### WC-OUT-1 · One", enforced) })).toEqual([])
  })

  it("fails an unknown repository, an empty check and a cross-repository name without the space", () => {
    expect(
      check({ "output.md": rule("### WC-OUT-1 · One", "`cli-kore: pnpm test` · `cli-core: ` · `cli-core:pnpm test`") }),
    ).toEqual([
      `output.md:4: "cli-kore: pnpm test" names an unknown repository "cli-kore" — use one of ${OTHER_REPOSITORIES.join(", ")}`,
      'output.md:4: "cli-core: " names no check after "cli-core:"',
      'output.md:4: "cli-core:pnpm test" is not a known check — name one or say "review only"',
    ])
  })

  it('reads every line of an "Enforced by" entry that wraps', () => {
    const wrapped = "`flag-synonym` · `pnpm\n  lint` · `writeData`\n  (weekly)."
    expect(check({ "output.md": rule("### WC-OUT-1 · One", wrapped) })).toEqual([
      'output.md:4: "writeData" is not a known check — name one or say "review only"',
    ])
    expect(check({ "output.md": rule("### WC-OUT-1 · One", "review\n  only.") })).toEqual([])
  })

  it("accepts a moved or merged rule as a one-line entry that points at a live rule", () => {
    const pages = {
      "output.md": [rule("### WC-OUT-1 · One"), "### WC-OUT-2 · Moved to [WC-CMD-1](commands.md#wc-cmd-1--one)\n"].join(
        "\n",
      ),
      "commands.md": [
        rule("### WC-CMD-1 · One"),
        "### WC-CMD-2 · Merged into WC-CMD-1\n",
        rule("### WC-CMD-3 · Three"),
      ].join("\n"),
    }
    const index2 = `${index}\n| [Commands](commands.md) | \`CMD\` | 2 | commands |`
    expect(standardsProblems({ index: index2, pages: new Map(Object.entries(pages)) }, known)).toEqual([])
  })

  it("fails a pointer at a missing rule, at another pointer or at itself", () => {
    expect(
      check({
        "output.md": [
          rule("### WC-OUT-1 · One"),
          "### WC-OUT-2 · Moved to WC-OUT-9\n",
          "### WC-OUT-3 · Merged into WC-OUT-2\n",
          "### WC-OUT-4 · Merged into WC-OUT-4\n",
        ].join("\n"),
      }),
    ).toEqual([
      "output.md:6: WC-OUT-2 points at WC-OUT-9, which is not a rule",
      "output.md:8: WC-OUT-3 points at WC-OUT-2, which is not a rule",
      "output.md:10: WC-OUT-4 points at itself",
    ])
  })

  it("fails an index rule count that does not match the page", () => {
    const counted = index.replace("| `OUT` | output |", "| `OUT` | 3 | output |")
    const pages = new Map(
      Object.entries({ "output.md": [rule("### WC-OUT-1 · One"), "### WC-OUT-2 · Merged into WC-OUT-1\n"].join("\n") }),
    )
    expect(standardsProblems({ index: counted, pages }, known)).toEqual([
      "output.md: the index counts 3 rules, the page has 1",
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

  it("knows a file in this repository by its path, and only one that exists", () => {
    const names = knownChecks(join(import.meta.dirname, ".."), { LINT_RULES, AUDIT_RULES })
    expect(names.has("src/keyring.test.ts")).toBe(true)
    expect(names.has("src/no-such-file.test.ts")).toBe(false)
    expect(names.has("package.json")).toBe(false)
  })
})
