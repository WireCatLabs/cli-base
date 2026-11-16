/**
 * `cli-dev ready`: is this CLI ready to release? It runs the CLI's own scripts for each check in a fixed order and
 * reports what each one proves. A row is verified only by a script that passed, or by a live-check record of exactly
 * this code; nothing is inferred, and a script that is missing proves nothing.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { parseArgs } from "node:util"
import { packageVersion } from "../release/index.js"
import { LIVE_FILE, liveCheckProblems, parseLiveRecords } from "./conformance.js"
import type { Shell } from "./land.js"
import type { VitestReport } from "./slow-tests.js"

interface DevIo {
  cwd: string
  out: (text: string) => void
  err: (text: string) => void
}

export type ReadyStatus = "verified" | "partially" | "not verified" | "unsupported"

export interface ReadyRow {
  id: string
  title: string
  status: ReadyStatus
  /** A passing script, a test file that runs a contract, a live-check record's line; why a row is not verified. */
  evidence: string[]
  /** The one thing to do for this row, when it is not verified. */
  fix?: string
}

export interface ReadyReport {
  category?: string
  rows: ReadyRow[]
  /** The fix of the first row that is not verified, or nothing when every row is verified or unsupported. */
  next?: string
}

/**
 * cli-core's contracts for each category `new` writes into `docs/dev/DESIGN.md`, by its value or its label. A
 * category without contracts has none to run; one not listed here is unknown, never "none".
 */
const CATEGORY_CONTRACTS: { names: string[]; contracts: string[] }[] = [
  {
    names: ["crm", "crm (sales: deals, contacts, companies)"],
    contracts: ["crmSourceContract", "crmSyncContract", "crmWriteContract"],
  },
  { names: ["files", "files and documents"], contracts: ["documentCommandsContract", "documentSourceContract"] },
  { names: ["calendar"], contracts: ["calendarSourceContract", "calendarSyncContract", "calendarWriterContract"] },
  { names: ["mail"], contracts: ["mailSourceContract", "mailSyncContract"] },
  {
    names: ["meetings"],
    contracts: [
      "recordingTransferStorageContract",
      "recordingSyncCheckpointStoreContract",
      "eventStoreContract",
      "meetingManagementContract",
      "meetingTranscriptStoreContract",
    ],
  },
  { names: ["messenger", "notes"], contracts: [] },
]

const DESIGN = "docs/dev/DESIGN.md"

export const designCategory = (design: string): string | undefined =>
  design.match(/^\s*[-*]\s*\*\*Category:\*\*\s*(.+?)\s*$/im)?.[1]

const testFiles = (cwd: string, folder: string): string[] => {
  const root = join(cwd, folder)
  if (!existsSync(root)) return []
  const found: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.test\.[cm]?[jt]sx?$/.test(name)) found.push(path)
    }
  }
  walk(root)
  return found.sort()
}

interface ContractCall {
  file: string
  line: number
  contract: string
}

const contractCalls = (cwd: string, contracts: readonly string[]): ContractCall[] =>
  ["src", "test"].flatMap((folder) =>
    testFiles(cwd, folder).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((text, index) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(text)) return []
          const contract = contracts.find((name) => new RegExp(`\\b${name}\\s*[(<]`).test(text))
          return contract ? [{ file, line: index + 1, contract }] : []
        }),
    ),
  )

/**
 * A call in the source proves nothing until the test run shows it ran: the file's tests in vitest's report, at least
 * one passed and none skipped, so a call under `describe.skip` or outside the vitest config does not count.
 */
const ranInReport = (report: VitestReport | undefined, file: string): string | undefined => {
  const result = report?.testResults.find((entry) => entry.name === file)
  if (!result) return "not in the test run's report"
  const statuses = result.assertionResults.map((test) => test.status)
  const skipped = statuses.filter((status) => status === "skipped" || status === "pending" || status === "todo")
  if (skipped.length > 0) return `${skipped.length} of its tests skipped`
  return statuses.includes("passed") ? undefined : "no test of it passed"
}

const lastLines = (out: string, count = 3) =>
  out
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-count)
    .join(" | ")

interface ScriptRun {
  script: string
  passed: boolean
  missing?: boolean
  evidence: string
}

const runScript = (
  io: DevIo,
  shell: Shell,
  scripts: Record<string, string>,
  script: string,
  extra: readonly string[] = [],
): ScriptRun => {
  if (scripts[script] === undefined)
    return { script, passed: false, missing: true, evidence: `no "${script}" script in package.json` }
  io.err(`ready: pnpm ${script}`)
  {
    const result = shell.run("pnpm", ["run", "--silent", script, ...extra])
    return result.ok
      ? { script, passed: true, evidence: `pnpm ${script}: passed` }
      : { script, passed: false, evidence: `pnpm ${script}: failed — ${lastLines(result.out) || "no output"}` }
  }
}

const scriptRow = (id: string, title: string, runs: readonly ScriptRun[], extra: string[] = []): ReadyRow => {
  const passed = runs.filter((run) => run.passed).length
  const failed = runs.find((run) => !run.passed)
  const status: ReadyStatus = passed === runs.length ? "verified" : passed > 0 ? "partially" : "not verified"
  return {
    id,
    title,
    status,
    evidence: [...runs.map((run) => run.evidence), ...extra],
    ...(failed
      ? {
          fix: failed.missing
            ? `add the "${failed.script}" script from @wirecat/cli-template, then run cli-dev ready again`
            : `pnpm ${failed.script}, and fix what it reports`,
        }
      : {}),
  }
}

const CATEGORY_NAMES = CATEGORY_CONTRACTS.flatMap((entry) => entry.names)

const contractsRow = (
  cwd: string,
  category: string | undefined,
  runs: readonly ScriptRun[],
  report: VitestReport | undefined,
): ReadyRow => {
  const title = "Tests and category contracts"
  const contracts = category
    ? CATEGORY_CONTRACTS.find((entry) => entry.names.includes(category.toLowerCase()))?.contracts
    : undefined
  if (contracts === undefined)
    return {
      id: "contracts",
      title,
      status: "not verified",
      evidence: [
        category ? `"${category}" in ${DESIGN} is no category new writes` : `no "- **Category:**" line in ${DESIGN}`,
        ...runs.map((run) => run.evidence),
      ],
      fix: `name the category in ${DESIGN} as one of ${CATEGORY_NAMES.join(", ")}, then run cli-dev ready again`,
    }
  if (contracts.length === 0)
    return scriptRow("contracts", title, runs, [`cli-core has no category contract for "${category}"`])
  const calls = contractCalls(cwd, contracts)
  const evidence = calls.map(({ file, line, contract }) => {
    const notRun = ranInReport(report, file)
    return `${relative(cwd, file)}:${line} calls ${contract}${notRun ? ` — not counted: ${notRun}` : ""}`
  })
  const ran = new Set(calls.filter(({ file }) => ranInReport(report, file) === undefined).map((call) => call.contract))
  const notRun = contracts.filter((contract) => !ran.has(contract))
  const row = scriptRow("contracts", title, runs, [
    ...evidence,
    ...(notRun.length > 0 && ran.size > 0 ? [`not run: ${notRun.join(", ")}`] : []),
  ])
  if (ran.size > 0) return row
  return {
    ...row,
    status: row.status === "verified" ? "partially" : row.status,
    evidence: [...row.evidence, `no test that ran calls ${contracts.join(" or ")}`],
    fix: row.fix ?? `run cli-core's ${contracts[0]} in a test (testing.md), then run cli-dev ready again`,
  }
}

const liveRow = (cwd: string, shell: Shell, version: string): ReadyRow => {
  const title = "Live check against the service"
  const record = `cli-dev live record --script <its script>`
  // cli-template's own repository has no service to check (WC-REL-17's exception); `new` never copies kit/.
  if (existsSync(join(cwd, "kit")))
    return { id: "live", title, status: "unsupported", evidence: ["kit/ exists: cli-template has no service to check"] }
  const text = existsSync(join(cwd, LIVE_FILE)) ? readFileSync(join(cwd, LIVE_FILE), "utf8") : ""
  const lines = text.split("\n")
  const lineOf = (wanted: string) => {
    const index = lines.findLastIndex((line) => line.trim().split(/\s+/)[0] === wanted)
    return index < 0 ? undefined : `${LIVE_FILE}:${index + 1}`
  }
  const records = parseLiveRecords(text)
  const problems = liveCheckProblems(shell, records, version)
  const own = lineOf(version)
  if (problems.length === 0 && own) return { id: "live", title, status: "verified", evidence: [own] }
  if (own)
    return {
      id: "live",
      title,
      status: "partially",
      evidence: [own, ...problems],
      fix: `run the live check on this code, then ${record}`,
    }
  const earlier = records.at(-1)
  return {
    id: "live",
    title,
    status: "not verified",
    evidence: [
      `no record for ${version} in ${LIVE_FILE}`,
      ...(earlier ? [`${lineOf(earlier.version)} is ${earlier.version}'s`] : []),
    ],
    fix: `run the live check (the owner runs it against their account), then ${record}`,
  }
}

/** Where `ready` asks vitest for its JSON report; `coverage/` is git-ignored in every CLI. */
export const READY_TESTS = "coverage/ready-tests.json"

export const readyReport = (io: DevIo, shell: Shell): ReadyReport => {
  const { cwd } = io
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { scripts?: Record<string, string> }
  const scripts = pkg.scripts ?? {}
  const design = existsSync(join(cwd, DESIGN)) ? readFileSync(join(cwd, DESIGN), "utf8") : ""
  const category = designCategory(design)
  const run = (...names: string[]) => names.map((name) => runScript(io, shell, scripts, name))
  const reportFile = join(cwd, READY_TESTS)
  rmSync(reportFile, { force: true })
  const tests = runScript(io, shell, scripts, "test", [
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${reportFile}`,
  ])
  const report = existsSync(reportFile) ? (JSON.parse(readFileSync(reportFile, "utf8")) as VitestReport) : undefined

  const rows: ReadyRow[] = [
    scriptRow("types", "Typecheck and lint", run("typecheck", "lint")),
    contractsRow(cwd, category, [tests, ...run("contracts:check")], report),
    scriptRow("audit", "Family audit of the commands", run("audit:commands")),
    scriptRow("docs", "Documents", run("docs:check")),
    scriptRow("generated", "Generated files: commands page, manifest, API spec", run("generate:check")),
    scriptRow("smoke", "Smoke run of the built CLI", run("smoke")),
    scriptRow("no-leak", "No secret in output", run("security:no-leak")),
    scriptRow("deps", "Dependencies", run("deps:check")),
    liveRow(cwd, shell, packageVersion(cwd)),
  ]
  const next = rows.find((row) => row.status === "not verified" || row.status === "partially")?.fix
  return { ...(category ? { category } : {}), rows, ...(next ? { next } : {}) }
}

const MARK: Record<ReadyStatus, string> = {
  verified: "verified",
  partially: "partially",
  "not verified": "NOT VERIFIED",
  unsupported: "unsupported",
}

export const readyText = (report: ReadyReport): string => {
  const width = report.rows.reduce((widest, row) => Math.max(widest, row.title.length), 0)
  const lines = [`category: ${report.category ?? "not named"}`, ""]
  for (const row of report.rows) {
    lines.push(`${row.title.padEnd(width)}  ${MARK[row.status]}`)
    for (const evidence of row.evidence) lines.push(`${" ".repeat(width + 2)}${evidence}`)
  }
  lines.push("", report.next ? `next: ${report.next}` : "next: nothing; every check is verified or does not apply")
  return lines.join("\n")
}

export const ready = (args: string[], io: DevIo, shell: Shell): number => {
  const { values } = parseArgs({ args, options: { json: { type: "boolean", default: false } } })
  const report = readyReport(io, shell)
  io.out(values.json ? JSON.stringify(report, null, 2) : readyText(report))
  return report.next ? 1 : 0
}

export const READY_USAGE = `  ready [--json]                       runs the CLI's checks in order (typecheck and lint, tests and its
                                       category's cli-core contracts, the family audit, docs:check,
                                       generate:check, smoke, security:no-leak,
                                       deps:check) and reads the live-check record; prints each row as
                                       verified, partially, not verified or unsupported with its evidence,
                                       and the one next step; exits 1 until every row is verified or
                                       unsupported`
