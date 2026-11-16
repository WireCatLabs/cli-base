/**
 * `cli-dev ready`: is this CLI ready to release? It runs the CLI's own scripts for each check in a fixed order and
 * reports what each one proves. A row is verified only by a script that passed, or by a live-check record of exactly
 * this code; nothing is inferred, and a script that is missing proves nothing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { parseArgs } from "node:util"
import { packageVersion } from "../release/index.js"
import { LIVE_FILE, liveCheckProblems, parseLiveRecords } from "./conformance.js"
import type { Shell } from "./land.js"

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

/** cli-core's contracts for each category of `docs/dev/DESIGN.md`; a category without one has none to run. */
const CATEGORY_CONTRACTS: { match: RegExp; contracts: string[] }[] = [
  { match: /\bcrm\b/i, contracts: ["crmSourceContract", "crmSyncContract", "crmWriteContract"] },
  { match: /\b(files|documents?)\b/i, contracts: ["documentCommandsContract", "documentSourceContract"] },
  { match: /\bcalendar\b/i, contracts: ["calendarSourceContract", "calendarSyncContract", "calendarWriterContract"] },
  { match: /\bmail\b/i, contracts: ["mailSourceContract", "mailSyncContract"] },
  {
    match: /\bmeetings?\b/i,
    contracts: ["meetingStoreContract", "meetingManagementContract", "meetingTranscriptStoreContract"],
  },
  { match: /\b(messenger|messages|notes)\b/i, contracts: [] },
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

/** `src/library.test.ts:12 documentCommandsContract` for each test that calls one of the contracts. */
const contractCalls = (cwd: string, contracts: readonly string[]): string[] =>
  ["src", "test"].flatMap((folder) =>
    testFiles(cwd, folder).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => {
          const name = contracts.find((contract) => new RegExp(`\\b${contract}\\s*[(<]`).test(line))
          return name ? [`${relative(cwd, file)}:${index + 1} calls ${name}`] : []
        }),
    ),
  )

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
  evidence: string
}

const runScripts = (shell: Shell, scripts: Record<string, string>, names: readonly string[]): ScriptRun[] =>
  names.map((script) => {
    if (scripts[script] === undefined)
      return { script, passed: false, evidence: `no "${script}" script in package.json` }
    const result = shell.run("pnpm", ["run", "--silent", script])
    return result.ok
      ? { script, passed: true, evidence: `pnpm ${script}: passed` }
      : { script, passed: false, evidence: `pnpm ${script}: failed — ${lastLines(result.out) || "no output"}` }
  })

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
          fix: failed.evidence.startsWith("no ")
            ? `add the "${failed.script}" script from @wirecat/cli-template, then run cli-dev ready again`
            : `pnpm ${failed.script}, and fix what it reports`,
        }
      : {}),
  }
}

const contractsRow = (cwd: string, category: string | undefined, runs: readonly ScriptRun[]): ReadyRow => {
  const title = "Tests and category contracts"
  if (category === undefined)
    return {
      id: "contracts",
      title,
      status: "not verified",
      evidence: [`no "- **Category:**" line in ${DESIGN}`, ...runs.map((run) => run.evidence)],
      fix: `name the category in ${DESIGN} ("- **Category:** crm"), then run cli-dev ready again`,
    }
  const contracts = CATEGORY_CONTRACTS.find((entry) => entry.match.test(category))?.contracts
  if (contracts === undefined || contracts.length === 0) {
    const row = scriptRow("contracts", title, runs, [`cli-core has no category contract for "${category}"`])
    return row
  }
  const calls = contractCalls(cwd, contracts)
  const row = scriptRow("contracts", title, runs, calls)
  if (calls.length > 0) return row
  return {
    ...row,
    status: row.status === "verified" ? "partially" : row.status,
    evidence: [...row.evidence, `no test calls ${contracts.join(" or ")}`],
    fix: row.fix ?? `run cli-core's ${contracts[0]} in a test (testing.md), then run cli-dev ready again`,
  }
}

const liveRow = (cwd: string, shell: Shell, version: string): ReadyRow => {
  const title = "Live check against the service"
  const record = `cli-dev live record --script <its script>`
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
      evidence: [`${own} checked other code`, ...problems],
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

export const readyReport = (cwd: string, shell: Shell): ReadyReport => {
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { scripts?: Record<string, string> }
  const scripts = pkg.scripts ?? {}
  const design = existsSync(join(cwd, DESIGN)) ? readFileSync(join(cwd, DESIGN), "utf8") : ""
  const category = designCategory(design)
  const run = (...names: string[]) => runScripts(shell, scripts, names)

  const rows: ReadyRow[] = [
    scriptRow("types", "Typecheck and lint", run("typecheck", "lint")),
    contractsRow(cwd, category, run("test", "contracts:check")),
    scriptRow("audit", "Family audit of the commands", run("audit:commands")),
    scriptRow("docs", "Documents", run("docs:check")),
    // A CLI without a spec/ folder has no generated API to cover; one with it proves coverage or is not verified.
    existsSync(join(cwd, "spec"))
      ? scriptRow("spec", "Spec coverage of the generated API", run("generate:check"))
      : {
          id: "spec",
          title: "Spec coverage of the generated API",
          status: "unsupported",
          evidence: ["no spec/ folder: the CLI generates nothing from an API spec"],
        },
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
  const report = readyReport(io.cwd, shell)
  io.out(values.json ? JSON.stringify(report, null, 2) : readyText(report))
  return report.next ? 1 : 0
}

export const READY_USAGE = `  ready [--json]                       runs the CLI's checks in order (typecheck and lint, tests and its
                                       category's cli-core contracts, the family audit, docs:check,
                                       generate:check when spec/ exists, smoke, security:no-leak,
                                       deps:check) and reads the live-check record; prints each row as
                                       verified, partially, not verified or unsupported with its evidence,
                                       and the one next step; exits 1 until every row is verified or
                                       unsupported`
