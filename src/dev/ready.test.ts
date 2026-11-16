import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Shell } from "./land.js"
import { designCategory, ready, readyReport } from "./ready.js"

const SCRIPTS = [
  "typecheck",
  "lint",
  "test",
  "contracts:check",
  "audit:commands",
  "docs:check",
  "generate:check",
  "smoke",
  "security:no-leak",
  "deps:check",
]

const cli = (files: Record<string, string>, scripts: readonly string[] = SCRIPTS) => {
  const cwd = mkdtempSync(join(tmpdir(), "cli-dev-ready-"))
  const all: Record<string, string> = {
    "package.json": JSON.stringify({
      version: "0.3.0",
      scripts: Object.fromEntries(scripts.map((name) => [name, "true"])),
    }),
    "docs/dev/DESIGN.md": "# Design\n\n- **Category:** CRM (sales: deals, contacts, companies)\n",
    "src/crm.test.ts": 'import { crmSourceContract } from "@wirecat/cli-core/crm/testing"\n\ncrmSourceContract(make)\n',
    "docs/dev/live-checks.txt": "# version commit date script\n0.3.0 abc123 2026-11-16 bin/acme-live\n",
    ...files,
  }
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(cwd, path, ".."), { recursive: true })
    writeFileSync(join(cwd, path), text)
  }
  return cwd
}

const shell = (failing: Record<string, string> = {}, calls: string[] = []): Shell => ({
  run: (command, args) => {
    const call = [command, ...args].join(" ")
    calls.push(call)
    const failed = Object.entries(failing).find(([match]) => call.includes(match))
    return failed ? { ok: false, out: failed[1] } : { ok: true, out: "" }
  },
  sleep: () => {},
})

const statuses = (cwd: string, run: Shell) =>
  Object.fromEntries(readyReport(cwd, run).rows.map((row) => [row.id, row.status]))

describe("cli-dev ready", () => {
  it("verifies each row by a passing script, a test calling the category contract and this code's live record", () => {
    const calls: string[] = []
    const cwd = cli({ "spec/acme/openapi.json": "{}" })
    const report = readyReport(cwd, shell({}, calls))
    expect(report.rows.every((row) => row.status === "verified")).toBe(true)
    expect(report.next).toBeUndefined()
    expect(report.rows.find((row) => row.id === "contracts")?.evidence).toEqual([
      "pnpm test: passed",
      "pnpm contracts:check: passed",
      "src/crm.test.ts:3 calls crmSourceContract",
    ])
    expect(report.rows.find((row) => row.id === "live")?.evidence).toEqual(["docs/dev/live-checks.txt:2"])
    expect(calls.filter((call) => call.startsWith("pnpm")).map((call) => call.split(" ").at(-1))).toEqual(SCRIPTS)
  })

  it("takes a missing script as not verified, and leaves spec coverage out only without a spec folder", () => {
    const cwd = cli(
      {},
      SCRIPTS.filter((name) => name !== "lint" && name !== "smoke" && name !== "generate:check"),
    )
    expect(statuses(cwd, shell())).toMatchObject({ types: "partially", spec: "unsupported", smoke: "not verified" })
    expect(readyReport(cwd, shell()).next).toBe(
      'add the "lint" script from @wirecat/cli-template, then run cli-dev ready again',
    )
    const withSpec = cli(
      { "spec/acme/openapi.json": "{}" },
      SCRIPTS.filter((name) => name !== "generate:check"),
    )
    expect(statuses(withSpec, shell()).spec).toBe("not verified")
  })

  it("names the failing script's last lines and makes it the next step", () => {
    const report = readyReport(cli({}), shell({ "docs:check": "checking\nREADME.md:3 broken link\n" }))
    expect(report.rows.find((row) => row.id === "docs")).toMatchObject({
      status: "not verified",
      evidence: ["pnpm docs:check: failed — checking | README.md:3 broken link"],
    })
    expect(report.next).toBe("pnpm docs:check, and fix what it reports")
  })

  it("does not verify the category without a test calling its contract, nor without a named category", () => {
    const noCall = readyReport(cli({ "src/crm.test.ts": "it('works', () => {})\n" }), shell())
    expect(noCall.rows.find((row) => row.id === "contracts")?.status).toBe("partially")
    expect(noCall.next).toBe("run cli-core's crmSourceContract in a test (testing.md), then run cli-dev ready again")
    const unnamed = readyReport(cli({ "docs/dev/DESIGN.md": "# Design\n" }), shell())
    expect(unnamed.rows.find((row) => row.id === "contracts")?.status).toBe("not verified")
    const messenger = cli({ "docs/dev/DESIGN.md": "- **Category:** messenger\n" })
    expect(readyReport(messenger, shell()).rows.find((row) => row.id === "contracts")?.evidence).toContain(
      'cli-core has no category contract for "messenger"',
    )
  })

  it("does not verify the live check from another version's record or from code changed since", () => {
    const other = readyReport(
      cli({ "docs/dev/live-checks.txt": "0.2.0 abc123 2026-11-10 bin/acme-live\n" }),
      shell(),
    ).rows.find((row) => row.id === "live")
    expect(other).toMatchObject({
      status: "not verified",
      evidence: ["no record for 0.3.0 in docs/dev/live-checks.txt", "docs/dev/live-checks.txt:1 is 0.2.0's"],
    })
    const changed = readyReport(cli({}), shell({ "git diff --quiet": "" })).rows.find((row) => row.id === "live")
    expect(changed?.status).toBe("partially")
    expect(changed?.fix).toBe("run the live check on this code, then cli-dev live record --script <its script>")
  })

  it("prints JSON for agents and exits 1 while a row is not verified", () => {
    const out: string[] = []
    const io = { cwd: cli({}, SCRIPTS.slice(1)), out: (text: string) => out.push(text), err: () => {} }
    expect(ready(["--json"], io, shell())).toBe(1)
    const report = JSON.parse(out.join(""))
    expect(report.category).toBe("CRM (sales: deals, contacts, companies)")
    expect(report.next).toBe('add the "typecheck" script from @wirecat/cli-template, then run cli-dev ready again')
  })

  it("reads the category line the template writes", () => {
    expect(designCategory("# x\n\n- **Category:** files and documents\n")).toBe("files and documents")
  })
})
