import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { liveTree } from "./conformance.js"
import type { Shell } from "./land.js"
import { designCategory, READY_TESTS, ready, readyReport } from "./ready.js"

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
const CRM_TEST =
  'import { crmSourceContract } from "@wirecat/cli-core/crm/testing"\n\ncrmSourceContract(make)\n' +
  "crmSyncContract(make)\ncrmWriteContract(make)\n"

const cli = (files: Record<string, string>, scripts: readonly string[] = SCRIPTS) => {
  const cwd = mkdtempSync(join(tmpdir(), "cli-dev-ready-"))
  const all: Record<string, string> = {
    "package.json": JSON.stringify({
      version: "0.3.0",
      scripts: Object.fromEntries(scripts.map((name) => [name, "true"])),
    }),
    "docs/dev/DESIGN.md": "# Design\n\n- **Category:** CRM (sales: deals, contacts, companies)\n",
    "src/crm.test.ts": CRM_TEST,
    "docs/dev/live-checks.txt": "# version commit date script\n0.3.0 abc123 2026-11-16 bin/acme-live\n",
    ...files,
  }
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(cwd, path, ".."), { recursive: true })
    writeFileSync(join(cwd, path), text)
  }
  return cwd
}

/** The CLI's tests as vitest reports them: each file's test statuses. */
type Ran = Record<string, string[]>

const shell = (cwd: string, ran: Ran = { "src/crm.test.ts": ["passed"] }, failing: Record<string, string> = {}) => {
  const calls: string[] = []
  const run: Shell = {
    run: (command, args) => {
      const call = [command, ...args].join(" ")
      calls.push(call)
      const report = args.find((arg) => arg.startsWith("--outputFile.json="))?.split("=")[1]
      if (report) {
        const testResults = Object.entries(ran).map(([file, statuses]) => ({
          name: join(cwd, file),
          assertionResults: statuses.map((status) => ({ title: "t", status })),
        }))
        mkdirSync(join(report, ".."), { recursive: true })
        writeFileSync(report, JSON.stringify({ testResults }))
      }
      const failed = Object.entries(failing).find(([match]) => call.includes(match))
      return failed ? { ok: false, out: failed[1] } : { ok: true, out: "" }
    },
    sleep: () => {},
  }
  return { run, calls }
}

const ioOf = (cwd: string) => {
  const out: string[] = []
  const err: string[] = []
  return { io: { cwd, out: (text: string) => out.push(text), err: (text: string) => err.push(text) }, out, err }
}

const rowsOf = (cwd: string, run: Shell) => readyReport(ioOf(cwd).io, run).rows
const row = (cwd: string, run: Shell, id: string) => rowsOf(cwd, run).find((one) => one.id === id)

describe("cli-dev ready", () => {
  it("verifies each row by a passing script, a contract test that ran and this code's live record", () => {
    const cwd = cli({})
    const { run, calls } = shell(cwd)
    const { io, err } = ioOf(cwd)
    const report = readyReport(io, run)
    expect(report.rows.map((one) => one.status)).toEqual(Array(9).fill("verified"))
    expect(report.next).toBeUndefined()
    expect(report.rows.find((one) => one.id === "contracts")?.evidence).toEqual([
      "pnpm test: passed",
      "pnpm contracts:check: passed",
      "src/crm.test.ts:3 calls crmSourceContract",
      "src/crm.test.ts:4 calls crmSyncContract",
      "src/crm.test.ts:5 calls crmWriteContract",
    ])
    expect(report.rows.find((one) => one.id === "live")?.evidence).toEqual(["docs/dev/live-checks.txt:2"])
    const scripts = calls.filter((call) => call.startsWith("pnpm")).map((call) => call.split(" ")[3])
    expect(scripts).toEqual(["test", "typecheck", "lint", "contracts:check", ...SCRIPTS.slice(4)])
    expect(calls[0]).toBe(
      `pnpm run --silent test --reporter=default --reporter=json --outputFile.json=${join(cwd, READY_TESTS)}`,
    )
    expect(err).toContain("ready: pnpm smoke")
  })

  it("takes a missing script as not verified, a row with one of two as partially", () => {
    const cwd = cli(
      {},
      SCRIPTS.filter((name) => name !== "lint" && name !== "generate:check"),
    )
    const { run } = shell(cwd)
    const report = readyReport(ioOf(cwd).io, run)
    expect(Object.fromEntries(report.rows.map((one) => [one.id, one.status]))).toMatchObject({
      types: "partially",
      generated: "not verified",
    })
    expect(report.next).toBe('add the "lint" script from @wirecat/cli-template, then run cli-dev ready again')
  })

  it("names the failing script's last lines and makes it the next step", () => {
    const cwd = cli({})
    const { run } = shell(cwd, undefined, { "docs:check": "checking\nREADME.md:3 broken link\n" })
    const report = readyReport(ioOf(cwd).io, run)
    expect(report.rows.find((one) => one.id === "docs")).toMatchObject({
      status: "not verified",
      evidence: ["pnpm docs:check: failed — checking | README.md:3 broken link"],
    })
    expect(report.next).toBe("pnpm docs:check, and fix what it reports")
  })

  it("counts a contract call only when its test file ran with no test skipped, and not in a comment", () => {
    const skipped = cli({})
    expect(row(skipped, shell(skipped, { "src/crm.test.ts": ["passed", "skipped"] }).run, "contracts")).toMatchObject({
      status: "not verified",
      fix:
        "run cli-core's crmSourceContract in a test (testing.md), or except it in lint/contract-exceptions.json " +
        "with its reason, then run cli-dev ready again",
    })
    const outside = cli({})
    expect(row(outside, shell(outside, {}).run, "contracts")?.evidence).toContain(
      "src/crm.test.ts:3 calls crmSourceContract — not counted: not in the test run's report",
    )
    const commented = cli({ "src/crm.test.ts": "// crmSourceContract(make)\n" })
    expect(row(commented, shell(commented).run, "contracts")?.status).toBe("not verified")
  })

  it("needs every contract of the category, and shows an excepted one as partially without holding back the exit", () => {
    const sourceOnly = "crmSourceContract(make)\n"
    const missing = cli({ "src/crm.test.ts": sourceOnly })
    expect(readyReport(ioOf(missing).io, shell(missing).run).next).toBe(
      "run cli-core's crmSyncContract in a test (testing.md), or except it in lint/contract-exceptions.json with its " +
        "reason, then run cli-dev ready again",
    )
    const exceptions = JSON.stringify([
      { contract: "crmSyncContract", reason: "the CLI keeps no local copy" },
      { contract: "crmWriteContract", reason: "read-only" },
    ])
    const excepted = cli({ "src/crm.test.ts": sourceOnly, "lint/contract-exceptions.json": exceptions })
    const { io } = ioOf(excepted)
    const report = readyReport(io, shell(excepted).run)
    expect(report.rows.find((one) => one.id === "contracts")).toMatchObject({
      status: "partially",
      evidence: expect.arrayContaining([
        "not run, excepted in lint/contract-exceptions.json: crmSyncContract — the CLI keeps no local copy",
      ]),
    })
    expect(report.next).toBeUndefined()
    const out: string[] = []
    expect(ready([], { ...io, out: (text) => out.push(text) }, shell(excepted).run)).toBe(0)
    expect(out.join("")).toContain(
      "next: nothing to do; partially, by declared exceptions: Tests and category contracts",
    )
  })

  it("refuses an exception without a reason, for another category's contract, or for one that runs", () => {
    const exceptions = JSON.stringify([
      { contract: "crmSyncContract", reason: " " },
      { contract: "mailSourceContract", reason: "x" },
      { contract: "crmSourceContract", reason: "x" },
    ])
    const cwd = cli({ "lint/contract-exceptions.json": exceptions })
    expect(row(cwd, shell(cwd).run, "contracts")).toMatchObject({
      status: "not verified",
      evidence: expect.arrayContaining([
        "lint/contract-exceptions.json: crmSyncContract has no reason",
        'lint/contract-exceptions.json: mailSourceContract is no contract of "CRM (sales: deals, contacts, companies)"',
        "lint/contract-exceptions.json: crmSourceContract runs now",
      ]),
      fix: "correct lint/contract-exceptions.json: crmSyncContract has no reason, then run cli-dev ready again",
    })
  })

  it("reports a broken exceptions file instead of failing, and refuses excepting every contract", () => {
    const cases: [string, string][] = [
      ["{", "lint/contract-exceptions.json: is not valid JSON"],
      ['{ "crmSyncContract": "x" }', 'lint/contract-exceptions.json: is not a list of { "contract", "reason" }'],
      ['["crmSyncContract"]', 'lint/contract-exceptions.json: entry 1 is not { "contract", "reason" }'],
      [
        JSON.stringify([
          { contract: "crmSyncContract", reason: "a" },
          { contract: "crmSyncContract", reason: "b" },
        ]),
        "lint/contract-exceptions.json: crmSyncContract is listed twice",
      ],
    ]
    for (const [text, problem] of cases) {
      const cwd = cli({ "lint/contract-exceptions.json": text })
      const found = row(cwd, shell(cwd).run, "contracts")
      expect(found?.status).toBe("not verified")
      expect(found?.evidence.some((line) => line.startsWith(problem))).toBe(true)
    }
    const all = JSON.stringify(
      ["crmSourceContract", "crmSyncContract", "crmWriteContract"].map((contract) => ({ contract, reason: "x" })),
    )
    const cwd = cli({ "src/crm.test.ts": "it('works', () => {})\n", "lint/contract-exceptions.json": all })
    expect(row(cwd, shell(cwd).run, "contracts")).toMatchObject({
      status: "not verified",
      fix: "run at least one of crmSourceContract, crmSyncContract, crmWriteContract in a test (testing.md), then run cli-dev ready again",
    })
  })

  it("does not verify a category that is not named, or not one new writes", () => {
    for (const design of ["# Design\n", "- **Category:** CRN\n"]) {
      const cwd = cli({ "docs/dev/DESIGN.md": design })
      expect(row(cwd, shell(cwd).run, "contracts")?.status).toBe("not verified")
    }
    const messenger = cli({ "docs/dev/DESIGN.md": "- **Category:** messenger\n" })
    expect(row(messenger, shell(messenger).run, "contracts")).toMatchObject({
      status: "verified",
      evidence: [
        "pnpm test: passed",
        "pnpm contracts:check: passed",
        'cli-core has no category contract for "messenger"',
      ],
    })
  })

  it("asks a tracker for cli-core's tracker contract, by the category's value or its label", () => {
    for (const category of ["tracker", "issue tracker (issues, projects, teams)"]) {
      const cwd = cli({
        "docs/dev/DESIGN.md": `- **Category:** ${category}\n`,
        "src/tracker.test.ts": "it('x', () => {})\n",
      })
      expect(row(cwd, shell(cwd).run, "contracts")).toMatchObject({
        status: "not verified",
        fix:
          "run cli-core's trackerSourceContract in a test (testing.md), or except it in lint/contract-exceptions.json " +
          "with its reason, then run cli-dev ready again",
      })
    }
  })

  it("does not verify the live check from another version's record or from code changed since", () => {
    const other = cli({ "docs/dev/live-checks.txt": "0.2.0 abc123 2026-11-10 bin/acme-live\n" })
    expect(row(other, shell(other).run, "live")).toMatchObject({
      status: "not verified",
      evidence: ["no record for 0.3.0 in docs/dev/live-checks.txt", "docs/dev/live-checks.txt:1 is 0.2.0's"],
    })
    const changed = cli({})
    const { run } = shell(changed, undefined, { "git diff --quiet": "" })
    expect(row(changed, run, "live")).toMatchObject({
      status: "partially",
      fix: "run the live check on this code, then cli-dev live record --script <its script>",
    })
  })

  it("compares a v2 record's tree with the shipped files", () => {
    const listing = (out: string): Shell => ({ run: () => ({ ok: true, out }), sleep: () => {} })
    const tree = liveTree(listing("100644 blob a\tsrc/a.ts"))
    const cwd = cli({ "docs/dev/live-checks.txt": `0.3.0 abc123 2026-11-16 bin/acme-live ${tree}\n` })
    const scripts = shell(cwd).run
    const withListing = (out: string): Shell => ({
      run: (command, args) => (command === "git" ? { ok: true, out } : scripts.run(command, args)),
      sleep: () => {},
    })
    expect(row(cwd, withListing("100644 blob a\tsrc/a.ts"), "live")?.status).toBe("verified")
    expect(row(cwd, withListing("100644 blob b\tsrc/a.ts"), "live")?.status).toBe("partially")
  })

  it("leaves the live check out in cli-template itself, which has no service", () => {
    const cwd = cli({ "kit/README.md": "kit" })
    expect(row(cwd, shell(cwd).run, "live")?.status).toBe("unsupported")
  })

  it("prints JSON for agents and exits 1 while a row is not verified", () => {
    const cwd = cli({}, SCRIPTS.slice(1))
    const { io, out } = ioOf(cwd)
    expect(ready(["--json"], io, shell(cwd).run)).toBe(1)
    const report = JSON.parse(out.join(""))
    expect(report.category).toBe("CRM (sales: deals, contacts, companies)")
    expect(report.next).toBe('add the "typecheck" script from @wirecat/cli-template, then run cli-dev ready again')
  })

  it("reads the category line the template writes", () => {
    expect(designCategory("# x\n\n- **Category:** files and documents\n")).toBe("files and documents")
  })
})
