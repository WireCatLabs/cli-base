/**
 * `cli-dev`: the development scripts every CLI on cli-base used to carry a copy of. Each command
 * reads and writes under `cwd` and reports through `out` and `err`; `main` returns the exit code.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import spawn from "cross-spawn"
import * as v from "valibot"
import { parseCommandsDocument } from "../commands/document.js"
import {
  type ChangelogRules,
  changelogProblems,
  type DocsRules,
  docsProblems,
  JOURNAL_IDS,
  markdownFiles,
  structureProblems,
  versionScript,
} from "../release/index.js"
import {
  baselineProblems,
  baselineSchema,
  LINT_RULES,
  OVERRIDE_BUDGET,
  type Override,
  overridesProblems,
  overridesSchema,
} from "../standards/lint.js"
import { issuesOf } from "../standards/registry.js"
import { VOCABULARY } from "../standards/vocabulary.js"
import { baselineOf, judge, lintCommands } from "./lint.js"
import { nextVersion } from "./next-version.js"
import { slowTests, type VitestReport } from "./slow-tests.js"
import { matrixPage, matrixRows, type ProgramNode, parseArgvLog, type Untested } from "./test-matrix.js"

export interface DevIo {
  cwd: string
  out: (text: string) => void
  err: (text: string) => void
}

const USAGE = `usage: cli-dev <command> [options]

  slow-tests [report] [count]          the slowest tests and files (report: coverage/tests.json, count: 20)
  next-version <wanted> <latest> <versions-json>
                                       the version bin/release publishes, given npm's answers
  version [--sync] [--file <path>]     package.json's version against src/version.ts
  docs-check [--rules <module>] [--ids <A,B>] [--pages]
                                       links, anchors and the changelog's shape; --pages also
                                       docs/ against docs/meta.json, the docs portal's structure
  test-matrix --program <module> --untested <module> --name <cli> [--page <path>] [--check]
                                       docs/dev/test-matrix.md from coverage/argv.jsonl
  lint (--cli <bin> | --commands <file>) [--baseline <dir>] [--overrides <file>] [--budget <n>]
       [--write-baseline]              the command tree against the standard's rules; fails on a
                                       new violation, a stale baseline entry or override, or more
                                       overrides than the budget (10). --write-baseline rewrites
                                       lint/baseline/<rule>.json to today's violations`

const load = async (cwd: string, path: string): Promise<Record<string, unknown>> =>
  (await import(pathToFileURL(isAbsolute(path) ? path : join(cwd, path)).href)) as Record<string, unknown>

const report = (io: DevIo, problems: readonly string[], ok: string) => {
  for (const problem of problems) io.err(problem)
  if (problems.length > 0) return 1
  io.out(ok)
  return 0
}

const docsCheck = async (args: string[], io: DevIo) => {
  const { values } = parseArgs({
    args,
    options: { rules: { type: "string" }, ids: { type: "string" }, pages: { type: "boolean" } },
  })
  const root = io.cwd
  let changelog: ChangelogRules
  let docs: DocsRules
  if (values.rules) {
    // A module exporting the rules the release check uses too: `CHANGELOG` and `docsRules(root)`.
    const rules = await load(root, values.rules)
    changelog = rules.CHANGELOG as ChangelogRules
    docs = (rules.docsRules as (root: string) => DocsRules)(root)
  } else {
    const ids = [...JOURNAL_IDS, ...(values.ids?.split(",").filter(Boolean) ?? [])]
    changelog = {
      headings: ["Added", "Changed — may break callers", "Fixed", "Security", "Removed"],
      unreleased: "Unreleased",
      ids,
    }
    docs = { files: markdownFiles(root, new Set(["node_modules", "dist", "coverage", ".git", "docs_ai"])), ids }
  }
  return report(
    io,
    [
      ...changelogProblems(readFileSync(join(root, "CHANGELOG.md"), "utf8"), { ...changelog, release: false }),
      ...docsProblems(root, docs),
      ...(values.pages ? structureProblems(root) : []),
    ],
    "docs: ok",
  )
}

const testMatrix = async (args: string[], io: DevIo) => {
  const { values } = parseArgs({
    args,
    options: {
      program: { type: "string" },
      untested: { type: "string" },
      name: { type: "string" },
      page: { type: "string", default: "docs/dev/test-matrix.md" },
      check: { type: "boolean", default: false },
    },
  })
  if (!values.program || !values.untested || !values.name) {
    io.err("test-matrix needs --program, --untested and --name")
    return 2
  }
  const log = join(io.cwd, "coverage", "argv.jsonl")
  if (!existsSync(log)) {
    io.err("no coverage/argv.jsonl — run the suite first (pnpm test:matrix does)")
    return 1
  }
  const program = ((await load(io.cwd, values.program)).createProgram as () => ProgramNode)()
  const untested = (await load(io.cwd, values.untested)).UNTESTED as Untested[]
  const { rows, stale } = matrixRows(program, parseArgvLog(readFileSync(log, "utf8")), untested)
  writeFileSync(join(io.cwd, values.page), matrixPage(rows, values.name))

  let failed = false
  if (stale.length > 0) {
    failed = true
    io.err("untested entries that name nothing in the program any more:")
    for (const entry of stale) io.err(`  ${entry.command}${entry.option ? ` ${entry.option}` : ""}`)
  }
  const missing = rows.filter((row) => row.state === "missing")
  if (missing.length > 0 && values.check) {
    failed = true
    io.err(`${missing.length} commands or options with no test and no reason — see ${values.page}:`)
    for (const row of missing) io.err(`  ${row.command || "(global)"}${row.option ? ` ${row.option}` : ""}`)
  }
  const count = (state: string) => rows.filter((row) => row.state === state).length
  io.err(
    `test matrix: ${count("tested")} tested, ${count("untested")} untested with a reason, ${missing.length} missing`,
  )
  return failed ? 1 : 0
}

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`)
  }
}

const commandsJson = (io: DevIo, cli: string | undefined, file: string | undefined): unknown => {
  if (file) return readJson(isAbsolute(file) ? file : join(io.cwd, file))
  const bin = cli ?? ""
  const script = /\.[cm]?js$/.test(bin)
  const run = spawn.sync(script ? process.execPath : bin, [...(script ? [bin] : []), "commands", "--json"], {
    cwd: io.cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (run.error || run.status !== 0)
    throw new Error(`${bin} commands --json failed: ${run.error?.message ?? String(run.stderr).trim().split("\n")[0]}`)
  return JSON.parse(String(run.stdout))
}

const lint = (args: string[], io: DevIo) => {
  try {
    return lintRun(args, io)
  } catch (error) {
    io.err((error as Error).message)
    return 2
  }
}

const lintRun = (args: string[], io: DevIo) => {
  const { values } = parseArgs({
    args,
    options: {
      cli: { type: "string" },
      commands: { type: "string" },
      baseline: { type: "string", default: "lint/baseline" },
      overrides: { type: "string", default: "lint/overrides.json" },
      budget: { type: "string", default: String(OVERRIDE_BUDGET) },
      "write-baseline": { type: "boolean", default: false },
    },
  })
  if (Boolean(values.cli) === Boolean(values.commands)) {
    io.err("lint needs one of --cli <bin> or --commands <file>")
    return 2
  }
  const budget = Number(values.budget)
  if (!Number.isInteger(budget) || budget < 0) {
    io.err(`--budget takes a whole number, not "${values.budget}"`)
    return 2
  }

  let raw: unknown
  try {
    raw = commandsJson(io, values.cli, values.commands)
  } catch (error) {
    io.err((error as Error).message)
    return 2
  }
  const parsed = parseCommandsDocument(raw)
  if (!parsed.document) {
    io.err("the commands document is not the shape cli-base's commandsDocument() writes:")
    for (const problem of parsed.problems.slice(0, 20)) io.err(`  ${problem}`)
    if (parsed.problems.length > 20) io.err(`  … and ${parsed.problems.length - 20} more`)
    return 2
  }

  const problems: string[] = []
  const overridesPath = join(io.cwd, values.overrides)
  let overrides: Override[] = []
  if (existsSync(overridesPath)) {
    const read = v.safeParse(overridesSchema, readJson(overridesPath))
    const found = read.success ? overridesProblems(read.output) : issuesOf(read.issues)
    if (read.success) overrides = read.output
    problems.push(...found.map((issue) => `${values.overrides}: ${issue}`))
  }
  const baselineDir = join(io.cwd, values.baseline)
  const baseline: Record<string, string[]> = {}
  if (existsSync(baselineDir))
    for (const file of readdirSync(baselineDir).filter((name) => name.endsWith(".json"))) {
      const read = v.safeParse(baselineSchema, readJson(join(baselineDir, file)))
      const found = read.success ? baselineProblems(read.output) : issuesOf(read.issues)
      if (read.success) baseline[file.slice(0, -".json".length)] = read.output
      problems.push(...found.map((issue) => `${values.baseline}/${file}: ${issue}`))
    }

  const violations = lintCommands(parsed.document, VOCABULARY)
  const severity = new Map(LINT_RULES.map((rule) => [rule.id, rule.severity]))

  if (values["write-baseline"]) {
    mkdirSync(baselineDir, { recursive: true })
    for (const [rule, targets] of Object.entries(baselineOf(violations, overrides))) {
      const path = join(baselineDir, `${rule}.json`)
      if (targets.length > 0) writeFileSync(path, `${JSON.stringify(targets, null, 2)}\n`)
      else rmSync(path, { force: true })
      baseline[rule] = targets
    }
  }

  const verdict = judge(violations, baseline, overrides, budget)
  for (const id of verdict.unknownRules)
    problems.push(`no lint rule "${id}" (named in ${values.baseline} or ${values.overrides})`)
  for (const found of verdict.fresh)
    problems.push(`${severity.get(found.rule) ?? "?"}  ${found.rule}  ${found.target}: ${found.message}`)
  for (const entry of verdict.stale)
    problems.push(
      entry.in === "baseline"
        ? `stale baseline entry, fixed or overridden — remove it: ${values.baseline}/${entry.rule}.json "${entry.target}"`
        : `stale override, no such violation — remove it: ${entry.rule} "${entry.target}"`,
    )
  if (verdict.overBudget) problems.push(`${overrides.length} overrides; the budget is ${budget}`)

  io.err(
    `lint: ${violations.length} violations — ${verdict.baselined} in the baseline, ${verdict.overridden} overridden (budget ${budget}), ${verdict.fresh.length} new`,
  )
  return report(io, problems, "lint: ok")
}

export const main = async (argv: readonly string[], io: DevIo): Promise<number> => {
  const [command, ...args] = argv
  switch (command) {
    case "slow-tests": {
      const [file = "coverage/tests.json", count = "20"] = args
      const parsed = JSON.parse(readFileSync(join(io.cwd, file), "utf8")) as VitestReport
      io.out(slowTests(parsed, io.cwd, Number(count)))
      return 0
    }
    case "next-version": {
      const [wanted = "", latest = "", versions = ""] = args
      const found = nextVersion(wanted, latest, versions)
      if ("error" in found) {
        io.err(found.error)
        return 1
      }
      io.out(found.version)
      return 0
    }
    case "version": {
      const { values } = parseArgs({
        args,
        options: { sync: { type: "boolean", default: false }, file: { type: "string", default: "src/version.ts" } },
      })
      const { code, message } = versionScript(io.cwd, values.sync ? ["--sync"] : [], values.file)
      if (code === 0) io.out(message)
      else io.err(message)
      return code
    }
    case "docs-check":
      return docsCheck(args, io)
    case "test-matrix":
      return testMatrix(args, io)
    case "lint":
      return lint(args, io)
    case "help":
    case "--help":
    case "-h":
      io.out(USAGE)
      return 0
    default:
      io.err(command ? `cli-dev: no command "${command}"\n\n${USAGE}` : USAGE)
      return 2
  }
}
