/**
 * `cli-dev`: the development scripts every CLI on cli-base used to carry a copy of. Each command
 * reads and writes under `cwd` and reports through `out` and `err`; `main` returns the exit code.
 */
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import spawn from "cross-spawn"
import * as v from "valibot"
import { parseCommandsDocument } from "../commands/document.js"
import type { CommandInfo } from "../commands/registry.js"
import { taggedSection } from "../release/fold.js"
import {
  type ChangelogRules,
  changelogProblems,
  type DocsRules,
  docsProblems,
  JOURNAL_IDS,
  markdownFiles,
  packageVersion,
  structureProblems,
  versionScript,
} from "../release/index.js"
import { AUDIT_BLOCKS, defineParityGroups, PARITY_GROUPS, REQUIRED_ROOTS } from "../standards/audit.js"
import type { ErrorReason } from "../standards/errors.js"
import { defineReasons } from "../standards/errors.js"
import {
  baselineProblems,
  baselineSchema,
  LINT_RULES,
  OVERRIDE_BUDGET,
  OVERRIDE_RULE_REVIEW,
  type Override,
  overridesProblems,
  overridesSchema,
  rulesForReview,
} from "../standards/lint.js"
import { issuesOf, RegistryError } from "../standards/registry.js"
import { VOCABULARY } from "../standards/vocabulary.js"
import { type AuditInput, auditClis, scorecardTable, snakeKeys } from "./audit.js"
import { readCapabilities } from "./capabilities.js"
import { changelogChange, landChange, landFold, newestTag, processShell, restoreChange } from "./land.js"
import { baselineOf, judge, lintCommands, RUN_LOG_COMMANDS, type RunLogProbe, walk } from "./lint.js"
import { nextVersion } from "./next-version.js"
import type { ContractEdit } from "./shared-contracts.js"
import { slowTests, type VitestReport } from "./slow-tests.js"
import { matrixPage, matrixRows, type ProgramNode, parseArgvLog, type Untested } from "./test-matrix.js"

export interface DevIo {
  cwd: string
  /** The clock an override's `review_after` is judged by. */
  now?: () => Date
  out: (text: string) => void
  err: (text: string) => void
}

const USAGE = `usage: cli-dev <command> [options]

  slow-tests [report] [count]          the slowest tests and files (report: coverage/tests.json, count: 20)
  next-version <wanted> <latest> <versions-json>
                                       the version bin/release publishes, given npm's answers
  version [--sync] [--file <path>]     package.json's version against src/version.ts
  changelog fold [--version <x.y.z>] [--unreleased <title>] [--file <path>] [--land]
                                       folds the unreleased section (Unreleased) into the dated
                                       section below it when that is --version (package.json's), and
                                       merges a ### heading that section repeats; prints a line when
                                       it changed the file, nothing otherwise. --land lands it on main
                                       through a pull request, folding again on the new main once if
                                       main moved under it. Run it only while that version is not on npm
  changelog restore [--unreleased <title>] [--file <path>] [--land]
                                       puts the newest tagged version's section back to its text in
                                       the tag; an entry the tag lacks missed that release and moves
                                       to the unreleased section. Prints a line when it changed the
                                       file. --land lands it on main through a pull request
  docs-check [--rules <module>] [--ids <A,B>] [--pages]
                                       links, anchors and the changelog's shape; --pages also
                                       docs/ against docs/meta.json, the docs portal's structure
  test-matrix --program <module> --untested <module> --name <cli> [--page <path>] [--check]
                                       docs/dev/test-matrix.md from coverage/argv.jsonl
  lint (--cli <bin> | --commands <file>) [--baseline <dir>] [--overrides <file>] [--budget <n>]
       [--schemas <file>] [--write-baseline]
                                       the command tree against the standard's rules; fails on a
                                       new violation, a stale baseline entry or override, or more
                                       overrides than the budget (10). --write-baseline rewrites
                                       lint/baseline/<rule>.json to today's violations. --schemas
                                       is a JSON object of the CLI's own JSON Schemas by name
  audit (--cli <bin> | --commands <file>)... [--schemas <cli>=<file>]... [--reasons <cli>=<file>]...
        [--lint <cli>=<dir>]... [--capabilities <file>] [--complete] [--groups <file>] [--differences <file>]
        [--baseline <dir>] [--for <cli>] [--json] [--write-baseline]
                                       several CLIs against every lint rule and against each other:
                                       required roots, same path same contract, same flag same
                                       meaning, same entity same schema, same failure same reason.
                                       Prints the scorecard; fails on a new finding (one naming
                                       --for's CLI, when given). --lint judges that CLI's lint
                                       rules by its own lint/ folder; the rest by --baseline
                                       (audit/baseline). --groups replaces PARITY_GROUPS with the
                                       JSON list of parity groups in that file; --differences adds
                                       to the groups in use
  bundle --bin <dist/bin/name.js> [--external <package>]... [--anchor <package>]... [--harmless <path>]...
                                       bundles the compiled bin with esbuild (a devDependency) into
                                       dist/bundle/ and turns the bin into its loader. --external keeps
                                       a package outside (* matches anything); --anchor adds a package
                                       whose modules keep their installed place, as cli-core's do;
                                       --harmless names a third-party file whose import.meta or
                                       __dirname was read and found harmless. Fails when a bundled
                                       module would look for a file or package in the wrong place`

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

const changelog = (args: string[], io: DevIo) => {
  const [action, ...rest] = args
  if (action !== "fold" && action !== "restore") {
    io.err(`cli-dev changelog: no action "${action ?? ""}" — the ones there are: fold, restore`)
    return 2
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      version: { type: "string" },
      unreleased: { type: "string", default: "Unreleased" },
      file: { type: "string", default: "CHANGELOG.md" },
      land: { type: "boolean", default: false },
    },
  })
  const file = isAbsolute(values.file) ? values.file : join(io.cwd, values.file)
  try {
    if (action === "restore") {
      const shell = processShell(io.cwd)
      const tag = newestTag(shell, relative(io.cwd, file))
      if (!tag) {
        io.err("no v<x.y.z> tag yet: a first release has nothing to restore")
        return 0
      }
      if (!taggedSection(tag.text, tag.version)) {
        io.err(`v${tag.version}'s changelog has no section of its own; nothing to restore`)
        return 0
      }
      const change = (text: string) => restoreChange(text, tag.text, tag.version, values.unreleased)
      if (values.land) {
        const landed = landChange({
          file,
          branch: `release/restore-${tag.version}`,
          change,
          done: `main already has ${tag.version}'s notes as tagged`,
          shell,
          log: io.err,
        })
        if (landed) io.out(landed)
        return 0
      }
      const restored = change(readFileSync(file, "utf8"))
      if (!restored) return 0
      writeFileSync(file, restored.text)
      io.out(restored.line)
      return 0
    }
    const version = values.version ?? packageVersion(io.cwd)
    if (values.land) {
      const landed = landFold({
        file,
        version,
        unreleased: values.unreleased,
        shell: processShell(io.cwd),
        log: io.err,
      })
      if (landed) io.out(landed)
      return 0
    }
    const change = changelogChange(readFileSync(file, "utf8"), version, values.unreleased)
    if (!change) return 0
    writeFileSync(file, change.text)
    io.out(change.line)
    return 0
  } catch (error) {
    io.err(`${values.file}: ${(error as Error).message}`)
    return 1
  }
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

const commandsJson = (
  io: DevIo,
  cli: string | undefined,
  file: string | undefined,
  commandArgs = ["commands", "--json"],
): unknown => {
  if (file) return readJson(isAbsolute(file) ? file : join(io.cwd, file))
  const bin = cli ?? ""
  const script = /\.[cm]?js$/.test(bin)
  const run = spawn.sync(script ? process.execPath : bin, [...(script ? [bin] : []), ...commandArgs], {
    cwd: io.cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (run.error || run.status !== 0)
    throw new Error(`${bin} commands --json failed: ${run.error?.message ?? String(run.stderr).trim().split("\n")[0]}`)
  return JSON.parse(String(run.stdout))
}

const PROBE_FLAG = "--cli-dev-run-log-probe"

/**
 * Makes the built CLI fail once on an unknown flag and asks its own `runs list --json` whether that failure was
 * kept. The CLI sees a new empty home and nothing else from this environment: a stray `*_STATE_DIR` or
 * `XDG_STATE_HOME` would point it at the owner's real runs.
 */
export const probeRunLog = (cwd: string, bin: string, environment: NodeJS.ProcessEnv = process.env): RunLogProbe => {
  const home = mkdtempSync(join(tmpdir(), "cli-dev-run-log-"))
  const env: NodeJS.ProcessEnv = {
    PATH: environment.PATH ?? "",
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    CI: "true",
    ...(environment.SystemRoot ? { SystemRoot: environment.SystemRoot } : {}),
  }
  const script = /\.[cm]?js$/.test(bin)
  const call = (args: string[]) =>
    spawn.sync(script ? process.execPath : bin, [...(script ? [bin] : []), ...args], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    })
  try {
    const failed = call([PROBE_FLAG])
    if (failed.status === 0) return { kept: false, detail: `\`${PROBE_FLAG}\` did not fail, so nothing could be kept` }
    const listed = call(["runs", "list", "--json"])
    if (listed.status !== 0)
      return { kept: false, detail: `\`runs list --json\` exited ${listed.status ?? listed.error?.message}` }
    let items: unknown
    try {
      items = (JSON.parse(String(listed.stdout)) as { items?: unknown }).items
    } catch {
      return { kept: false, detail: "`runs list --json` did not print JSON" }
    }
    const kept = Array.isArray(items) && items.some((item) => (item as { status?: unknown })?.status === "failed")
    return kept ? { kept } : { kept, detail: `\`runs list --json\` shows no failed run after \`${PROBE_FLAG}\`` }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const readBaseline = (dir: string, label: string, problems: string[]) => {
  const baseline: Record<string, string[]> = {}
  if (existsSync(dir))
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
      const read = v.safeParse(baselineSchema, readJson(join(dir, file)))
      const found = read.success ? baselineProblems(read.output) : issuesOf(read.issues)
      if (read.success) baseline[file.slice(0, -".json".length)] = read.output
      problems.push(...found.map((issue) => `${label}/${file}: ${issue}`))
    }
  return baseline
}

const lint = (args: string[], io: DevIo) => {
  try {
    return lintRun(args, io)
  } catch (error) {
    io.err((error as Error).message)
    return 2
  }
}

const today = (io: DevIo) => (io.now?.() ?? new Date()).toISOString().slice(0, 10)

const lintRun = (args: string[], io: DevIo) => {
  const { values } = parseArgs({
    args,
    options: {
      cli: { type: "string" },
      commands: { type: "string" },
      baseline: { type: "string", default: "lint/baseline" },
      overrides: { type: "string", default: "lint/overrides.json" },
      budget: { type: "string", default: String(OVERRIDE_BUDGET) },
      schemas: { type: "string" },
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
    const found = read.success ? overridesProblems(read.output, today(io)) : issuesOf(read.issues)
    if (read.success) overrides = read.output
    problems.push(...found.map((issue) => `${values.overrides}: ${issue}`))
  }
  const baselineDir = join(io.cwd, values.baseline)
  const baseline = readBaseline(baselineDir, values.baseline, problems)

  const schemas = values.schemas === undefined ? undefined : readJson(join(io.cwd, values.schemas))
  if (schemas !== undefined && (typeof schemas !== "object" || schemas === null || Array.isArray(schemas))) {
    io.err(`${values.schemas}: a JSON object of JSON Schemas by name`)
    return 2
  }
  const paths = new Set(walk(parsed.document.commands).map((command) => command.path.join(" ")))
  const hasRuns = RUN_LOG_COMMANDS.every((path) => paths.has(path))
  const violations = lintCommands(parsed.document, VOCABULARY, LINT_RULES, {
    raw,
    schemas: schemas as Record<string, unknown> | undefined,
    ...(values.cli && hasRuns ? { runLog: probeRunLog(io.cwd, values.cli) } : {}),
  })
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

const byCli = (pairs: readonly string[] | undefined, flag: string): Map<string, string> =>
  new Map(
    (pairs ?? []).map((pair) => {
      const [cli, path] = pair.split(/=(.*)/s)
      if (!cli || !path) throw new Error(`${flag} takes <cli>=<path>, not "${pair}"`)
      return [cli, path]
    }),
  )

const audit = (args: string[], io: DevIo) => {
  try {
    return auditRun(args, io)
  } catch (error) {
    io.err((error as Error).message)
    return 2
  }
}

const auditRun = (args: string[], io: DevIo) => {
  const started = Date.now()
  const { values } = parseArgs({
    args,
    options: {
      cli: { type: "string", multiple: true },
      commands: { type: "string", multiple: true },
      schemas: { type: "string", multiple: true },
      capabilities: { type: "string" },
      complete: { type: "boolean", default: false },
      differences: { type: "string" },
      groups: { type: "string" },
      reasons: { type: "string", multiple: true },
      lint: { type: "string", multiple: true },
      baseline: { type: "string", default: "audit/baseline" },
      for: { type: "string" },
      json: { type: "boolean", default: false },
      "write-baseline": { type: "boolean", default: false },
    },
  })
  const raws = [
    ...(values.cli ?? []).map((bin) => commandsJson(io, bin, undefined)),
    ...(values.commands ?? []).map((file) => commandsJson(io, undefined, file)),
  ]
  if (raws.length < 2) {
    io.err("audit needs two or more CLIs: --cli <bin> or --commands <file>, repeated")
    return 2
  }
  const at = (path: string) => (isAbsolute(path) ? path : join(io.cwd, path))
  const schemas = byCli(values.schemas, "--schemas")
  const reasons = byCli(values.reasons, "--reasons")
  const lintDirs = byCli(values.lint, "--lint")
  const problems: string[] = []
  const evidence = new Map<
    string,
    {
      schemas?: Record<string, unknown>
      reasons?: ErrorReason[]
      contracts?: Record<string, Record<string, unknown>>
      overrides?: ContractEdit[]
    }
  >()
  if (values.complete) {
    for (const [index, bin] of (values.cli ?? []).entries()) {
      const raw = raws[index] as { cli?: string }
      const data = commandsJson(io, bin, undefined, ["commands", "info", "--json"]) as {
        schemas?: Record<string, unknown>
        reasons?: ErrorReason[]
        contracts?: Record<string, Record<string, unknown>>
        overrides?: ContractEdit[]
      }
      if (typeof raw.cli === "string") evidence.set(raw.cli, data)
    }
  }

  const inputs = raws.map((raw): AuditInput => {
    const parsed = parseCommandsDocument(snakeKeys(raw))
    if (!parsed.document)
      throw new Error(
        `a commands document is not the shape cli-base's commandsDocument() writes: ${parsed.problems[0]}`,
      )
    const cli = parsed.document.cli
    const input: AuditInput = { document: parsed.document, raw, ...evidence.get(cli) }
    const schemaFile = schemas.get(cli)
    if (schemaFile) input.schemas = readJson(at(schemaFile)) as Record<string, unknown>
    const reasonFile = reasons.get(cli)
    if (reasonFile) input.reasons = defineReasons(readJson(at(reasonFile)))
    if (values.complete) {
      if (
        !input.contracts ||
        typeof input.contracts !== "object" ||
        Array.isArray(input.contracts) ||
        Object.keys(input.contracts).length === 0
      )
        problems.push(`${cli}: complete audit needs core contract references from commands info`)
      for (const root of REQUIRED_ROOTS) {
        const path = root.path.join(" ")
        if (!input.contracts?.[path])
          problems.push(`${cli}: complete audit needs an inherited contract reference for ${path}`)
      }
      if (
        !input.schemas ||
        typeof input.schemas !== "object" ||
        Array.isArray(input.schemas) ||
        Object.keys(input.schemas).length === 0
      )
        problems.push(`${cli}: complete audit needs nonempty entity schemas from commands info or --schemas`)
      if (!Array.isArray(input.reasons) || input.reasons.length === 0)
        problems.push(`${cli}: complete audit needs declared error reasons from commands info or --reasons`)
      if (input.reasons) input.reasons = defineReasons(input.reasons)
      if (input.schemas) {
        const visit = (commands: readonly CommandInfo[]) => {
          for (const command of commands) {
            const names = [command.output?.entity, command.query?.entity].filter(
              (name): name is string => name !== undefined,
            )
            for (const name of names)
              if (input.schemas?.[name] === undefined)
                problems.push(`${cli}: complete audit has no schema for ${name} (${command.path.join(" ")})`)
            visit(command.commands)
          }
        }
        visit(input.document.commands)
      }
    }
    const dir = lintDirs.get(cli)
    if (dir) {
      const overridesPath = join(at(dir), "overrides.json")
      let overrides: Override[] = []
      if (existsSync(overridesPath)) {
        const read = v.safeParse(overridesSchema, readJson(overridesPath))
        const found = read.success ? overridesProblems(read.output, today(io)) : issuesOf(read.issues)
        if (read.success) overrides = read.output
        problems.push(...found.map((issue) => `${dir}/overrides.json: ${issue}`))
      }
      input.lint = {
        baseline: readBaseline(join(at(dir), "baseline"), `${dir}/baseline`, problems),
        overrides,
        budget: OVERRIDE_BUDGET,
      }
    }
    return input
  })
  for (const { rule, overrides } of rulesForReview(inputs.map((input) => input.lint?.overrides ?? [])))
    io.err(`review the rule ${rule}: ${overrides} overrides across these CLIs, more than ${OVERRIDE_RULE_REVIEW}`)
  const given = new Set(inputs.map((input) => input.document.cli))
  for (const [flag, map] of [
    ["--schemas", schemas],
    ["--reasons", reasons],
    ["--lint", lintDirs],
  ] as const)
    for (const cli of map.keys()) if (!given.has(cli)) problems.push(`${flag} names ${cli}, which is not audited`)
  if (values.for !== undefined && !given.has(values.for))
    problems.push(`--for names ${values.for}, which is not audited`)

  const baselineDir = at(values.baseline)
  const baseline = readBaseline(baselineDir, values.baseline, problems)
  let groups = PARITY_GROUPS
  if (values.groups) {
    try {
      groups = defineParityGroups(readJson(at(values.groups)))
    } catch (error) {
      if (error instanceof RegistryError) throw new Error(`${values.groups}: ${error.problems.join("; ")}`)
      throw error
    }
  }
  if (values.differences) {
    const schema = v.array(
      v.strictObject({
        group: v.string(),
        rule: v.string(),
        target: v.string(),
        expected: v.string(),
        reason: v.string(),
      }),
    )
    const parsed = v.safeParse(schema, readJson(at(values.differences)))
    if (!parsed.success) throw new Error(`${values.differences}: ${issuesOf(parsed.issues).join("; ")}`)
    for (const entry of parsed.output)
      if (!groups.some((group) => group.name === entry.group))
        throw new Error(`${values.differences}: unknown group ${entry.group}`)
    groups = defineParityGroups(
      groups.map((group) => ({
        ...group,
        differences: [
          ...group.differences,
          ...parsed.output.filter((entry) => entry.group === group.name).map(({ group: _, ...entry }) => entry),
        ],
      })),
    )
  }
  const result = auditClis(inputs, {
    ...(values.capabilities ? { capabilities: readCapabilities(readJson(at(values.capabilities))) } : {}),
    groups,
    roots: REQUIRED_ROOTS,
    vocabulary: VOCABULARY,
    baseline,
    blocks: AUDIT_BLOCKS,
    only: values.for,
  })
  problems.push(...result.problems)

  if (values["write-baseline"]) {
    mkdirSync(baselineDir, { recursive: true })
    for (const [rule, targets] of Object.entries(result.nextBaseline)) {
      const path = join(baselineDir, `${rule}.json`)
      if (targets.length > 0) writeFileSync(path, `${JSON.stringify(targets, null, 2)}\n`)
      else rmSync(path, { force: true })
    }
    io.err(`audit: wrote ${values.baseline}`)
    for (const problem of problems) io.err(problem)
    return problems.length > 0 ? 1 : 0
  }

  if (values.json)
    io.out(
      JSON.stringify({
        items: result.rows,
        page: { mode: "page", limit: Math.max(result.rows.length, 1), has_more: false },
        meta: { run_id: randomUUID(), duration_ms: Date.now() - started, complete: true },
      }),
    )
  else io.out(scorecardTable(result.rows))
  for (const finding of result.blocking) problems.push(`new  ${finding.rule}  ${finding.target}: ${finding.message}`)
  io.err(
    `audit: ${inputs.length} CLIs, ${result.findings.length} findings, ${result.blocking.length} new that block${
      AUDIT_BLOCKS === "never" ? " (cross-CLI divergences do not block)" : ""
    }`,
  )
  for (const problem of problems) io.err(problem)
  return problems.length > 0 ? 1 : 0
}

const bundleCommand = async (args: string[], io: DevIo) => {
  const { values } = parseArgs({
    args,
    options: {
      bin: { type: "string" },
      external: { type: "string", multiple: true },
      anchor: { type: "string", multiple: true },
      harmless: { type: "string", multiple: true },
    },
  })
  if (!values.bin) {
    io.err("bundle needs --bin <dist/bin/name.js>")
    return 2
  }
  // esbuild is an optional peer: the other commands, and a CLI that does not bundle, never load it.
  try {
    await import("esbuild")
  } catch {
    io.err("cli-dev bundle needs esbuild: add it as a devDependency, in cli-base's peer range")
    return 1
  }
  const { bundle } = await import("./bundle.js")
  const result = await bundle({
    root: io.cwd,
    bin: values.bin,
    external: values.external ?? [],
    anchored: values.anchor ?? [],
    harmless: values.harmless ?? [],
  })
  if (result.problems.length > 0) {
    io.err(`the bundle would look for these in the wrong place, or is incomplete:\n${result.problems.join("\n")}`)
    return 1
  }
  io.out(`bundle: ${values.bin} loads dist/bundle/; a server preloads ${result.chunks.length} chunks`)
  return 0
}

export const main = async (argv: readonly string[], io: DevIo): Promise<number> => {
  const [command, ...args] = argv
  if (args.includes("--help")) {
    io.out(USAGE)
    return 0
  }
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
    case "changelog":
      return changelog(args, io)
    case "docs-check":
      return docsCheck(args, io)
    case "test-matrix":
      return testMatrix(args, io)
    case "lint":
      return lint(args, io)
    case "audit":
      return audit(args, io)
    case "bundle":
      return bundleCommand(args, io)
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
