import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { packageVersion } from "../release/index.js"
import { defineParityGroups, PARITY_GROUPS } from "../standards/audit.js"
import { processShell, type Shell } from "./land.js"

interface DevIo {
  cwd: string
  now?: () => Date
  out: (text: string) => void
  err: (text: string) => void
}

/** The paths whose change since a live check means the release was not the code that was checked. */
export const LIVE_PATHS = ["src", "package.json", "pnpm-lock.yaml"] as const
export const LIVE_FILE = "docs/dev/live-checks.txt"

/** The text under a `Conformance` heading of any level, up to the next heading of that level or higher. */
export const conformanceSection = (body: string): string | undefined => {
  const lines = body.replaceAll("\r\n", "\n").split("\n")
  const start = lines.findIndex((line) => /^#{1,6}\s+Conformance\s*$/i.test(line))
  if (start < 0) return undefined
  const level = (lines[start] ?? "").match(/^#+/)?.[0].length ?? 1
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => (line.match(/^(#+)\s/)?.[1]?.length ?? 99) <= level)
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim()
}

/** A pull request that changes the version is a release pull request, and carries what was checked before it. */
export const releasePrProblems = (body: string, baseVersion: string, version: string): string[] => {
  if (baseVersion === version) return []
  const section = conformanceSection(body)
  if (section === undefined)
    return [`this pull request raises the version ${baseVersion} → ${version} and has no "## Conformance" section`]
  if (!section) return [`the "## Conformance" section of this ${version} release pull request is empty`]
  return []
}

export interface LiveRecord {
  version: string
  commit: string
  date: string
  script: string
}

export const parseLiveRecords = (text: string): LiveRecord[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [version = "", commit = "", date = "", script = ""] = line.split(/\s+/)
      return { version, commit, date, script }
    })

export const liveCheckProblems = (shell: Shell, records: readonly LiveRecord[], version: string): string[] => {
  const record = records.findLast((entry) => entry.version === version)
  if (!record)
    return [
      `no live check recorded for ${version} in ${LIVE_FILE}: run the live check, then ` +
        "`cli-dev live record --script <its script>` and commit the line in the release pull request",
    ]
  if (!shell.run("git", ["cat-file", "-e", `${record.commit}^{commit}`]).ok)
    return [`${version}'s live check names commit ${record.commit}, which this clone does not have; fetch it`]
  if (!shell.run("git", ["diff", "--quiet", record.commit, "HEAD", "--", ...LIVE_PATHS]).ok)
    return [
      `${LIVE_PATHS.join(", ")} changed since ${version}'s live check at ${record.commit.slice(0, 12)}: ` +
        "check the code that is released, and record it again",
    ]
  return []
}

const live = (args: string[], io: DevIo, shell: Shell) => {
  const [action, ...rest] = args
  const { values } = parseArgs({
    args: rest,
    options: {
      script: { type: "string" },
      version: { type: "string" },
      file: { type: "string", default: LIVE_FILE },
    },
  })
  const file = join(io.cwd, values.file)
  const version = values.version ?? packageVersion(io.cwd)
  if (action === "check") {
    const records = existsSync(file) ? parseLiveRecords(readFileSync(file, "utf8")) : []
    const problems = liveCheckProblems(shell, records, version)
    for (const problem of problems) io.err(problem)
    if (problems.length === 0) io.out(`live check: ${version} passed on the code being released`)
    return problems.length > 0 ? 1 : 0
  }
  if (action !== "record") {
    io.err(`cli-dev live: no action "${action ?? ""}" — the ones there are: record, check`)
    return 2
  }
  if (!values.script || /\s/.test(values.script)) {
    io.err("live record needs --script <the live check that passed>, a path without spaces")
    return 2
  }
  const dirty = shell.run("git", ["status", "--porcelain", "--", ...LIVE_PATHS])
  if (!dirty.ok || dirty.out) {
    io.err(`commit ${LIVE_PATHS.join(", ")} first: a record names the commit that was checked`)
    return 1
  }
  const commit = shell.run("git", ["rev-parse", "HEAD"]).out
  const date = (io.now?.() ?? new Date()).toISOString().slice(0, 10)
  const line = `${version} ${commit} ${date} ${values.script}`
  appendFileSync(
    file,
    `${existsSync(file) ? "" : "# version commit date script — one line per passed live check\n"}${line}\n`,
  )
  io.out(line)
  return 0
}

const releasePr = (args: string[], io: DevIo, shell: Shell) => {
  const { values } = parseArgs({ args, options: { base: { type: "string" }, body: { type: "string" } } })
  if (!values.base || !values.body) {
    io.err("release-pr needs --base <commit> and --body <file with the pull request's description>")
    return 2
  }
  const base = shell.run("git", ["show", `${values.base}:package.json`])
  if (!base.ok) {
    io.err(`cannot read package.json at ${values.base}: ${base.out.split("\n")[0]}`)
    return 2
  }
  const baseVersion = String((JSON.parse(base.out) as { version?: unknown }).version)
  const problems = releasePrProblems(
    readFileSync(join(io.cwd, values.body), "utf8"),
    baseVersion,
    packageVersion(io.cwd),
  )
  for (const problem of problems) io.err(problem)
  if (problems.length === 0) io.out("release pull request: ok")
  return problems.length > 0 ? 1 : 0
}

const REQUIRED_RULES = ["deletion", "non_fast_forward", "pull_request", "required_status_checks"]

/** `skipped` when GitHub could not be asked (no gh, no login, no network): the caller says so and goes on. */
export const rulesetProblems = (shell: Shell, slug: string): { problems: string[]; skipped?: string } => {
  const answer = shell.run("gh", ["api", `repos/${slug}/rules/branches/main`])
  if (!answer.ok) {
    const status = answer.out.match(/HTTP (\d{3})/)?.[1]
    if (status === "401" || (!status && /gh auth login|GH_TOKEN/.test(answer.out)))
      return { problems: [], skipped: "gh is not signed in (set GH_TOKEN in CI)" }
    if (!status) return { problems: [], skipped: `GitHub could not be reached: ${answer.out.split("\n")[0] ?? ""}` }
    return {
      problems: [
        `GitHub answered ${status} for ${slug}'s rules on main: ` +
          (answer.out.match(/gh: ([^\n]*?) \(HTTP/)?.[1] ?? "the repository is missing or this token cannot read it"),
      ],
    }
  }
  let types: string[]
  try {
    types = (JSON.parse(answer.out) as { type?: string }[]).map((rule) => String(rule.type))
  } catch {
    return { problems: [], skipped: "gh did not answer JSON" }
  }
  const missing = REQUIRED_RULES.filter((rule) => !types.includes(rule))
  return missing.length === 0
    ? { problems: [] }
    : { problems: [`main's ruleset lacks ${missing.join(", ")} (cli-base docs/standards/new-cli.md, step 1)`] }
}

/** The WC-CI-9 table of taken monthly minutes, as `HH:MM → repository`. */
export const takenMinutes = (ciPage: string): Map<string, string> =>
  new Map(
    [...ciPage.matchAll(/^\s*\|\s*(\d\d:\d\d)\s*\|\s*([\w.-]+)\s*\|\s*$/gm)].map(([, time, repo]) => [
      time as string,
      repo as string,
    ]),
  )

export const cronProblems = (workflow: string | undefined, repo: string, taken: Map<string, string>): string[] => {
  if (workflow === undefined) return [".github/workflows/monthly.yml is missing (WC-CI-9)"]
  const cron = workflow.match(/cron:\s*["']([^"']+)["']/)?.[1]
  const [minute, hour, day] = cron?.split(/\s+/) ?? []
  if (!cron || !/^\d+$/.test(minute ?? "") || !/^\d+$/.test(hour ?? ""))
    return ["monthly.yml has no fixed cron minute and hour (WC-CI-9)"]
  if (day !== "1") return [`monthly.yml runs on day ${day}, not the first of the month (WC-CI-9)`]
  const time = `${hour?.padStart(2, "0")}:${minute?.padStart(2, "0")}`
  const owner = taken.get(time)
  return owner && owner !== repo
    ? [`monthly.yml runs at ${time} UTC, ${owner}'s minute: pick a free one from WC-CI-9's list and add it there`]
    : []
}

export const parityProblems = (cli: string, ownGroups: unknown): string[] => {
  const groups = ownGroups === undefined ? PARITY_GROUPS : [...PARITY_GROUPS, ...defineParityGroups(ownGroups)]
  return groups.some((group) => group.members.includes(cli))
    ? []
    : [`${cli} is in no parity group: add it to cli-base's PARITY_GROUPS (new-cli.md, step 4)`]
}

const ciPagePath = () => join(dirname(fileURLToPath(import.meta.url)), "../../docs/standards/ci.md")

const repoCheck = (args: string[], io: DevIo, shell: Shell) => {
  const { values } = parseArgs({
    args,
    options: { cli: { type: "string" }, groups: { type: "string", default: "config/parity-groups.json" } },
  })
  if (!values.cli) {
    io.err("repo-check needs --cli <the command's name>")
    return 2
  }
  const manifest = JSON.parse(readFileSync(join(io.cwd, "package.json"), "utf8")) as {
    repository?: string | { url?: string }
  }
  const url = typeof manifest.repository === "string" ? manifest.repository : (manifest.repository?.url ?? "")
  const slug = url.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1]
  if (!slug) {
    io.err("package.json names no GitHub repository")
    return 2
  }
  const read = (path: string) => (existsSync(join(io.cwd, path)) ? readFileSync(join(io.cwd, path), "utf8") : undefined)
  const groups = read(values.groups)
  const ruleset = rulesetProblems(shell, slug)
  if (ruleset.skipped) io.err(`repo-check: ruleset not checked — ${ruleset.skipped}`)
  const problems = [
    ...ruleset.problems,
    ...cronProblems(
      read(".github/workflows/monthly.yml"),
      slug.split("/")[1] ?? "",
      takenMinutes(readFileSync(ciPagePath(), "utf8")),
    ),
    ...parityProblems(values.cli, groups === undefined ? undefined : JSON.parse(groups)),
  ]
  for (const problem of problems) io.err(problem)
  if (problems.length === 0) io.out(`repo-check: ${slug} ok`)
  return problems.length > 0 ? 1 : 0
}

export const CONFORMANCE_USAGE = `  release-pr --base <commit> --body <file>
                                       a pull request that changes package.json's version since --base
                                       needs a non-empty "## Conformance" section in its description
  live record --script <path> [--file <path>]
                                       appends "<version> <commit> <date> <script>" to ${LIVE_FILE}
                                       after a live check passed; src/, package.json and the lockfile
                                       must be committed
  live check [--version <x.y.z>] [--file <path>]
                                       fails unless that version has a record and src/, package.json
                                       and the lockfile are unchanged since its commit
  repo-check --cli <name> [--groups <file>]
                                       main's ruleset (through gh; skipped without a login or network),
                                       monthly.yml's cron minute against WC-CI-9's list, and the CLI in
                                       a parity group (cli-base's, or --groups', config/parity-groups.json)`

export const conformanceCommand = (
  command: string,
  args: string[],
  io: DevIo,
  shell: Shell = processShell(io.cwd),
): number | undefined => {
  if (command === "release-pr") return releasePr(args, io, shell)
  if (command === "live") return live(args, io, shell)
  if (command === "repo-check") return repoCheck(args, io, shell)
  return undefined
}
