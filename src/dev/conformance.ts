import { createHash } from "node:crypto"
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { packageVersion } from "../release/index.js"
import { defineParityGroups, PARITY_GROUPS } from "../standards/audit.js"
import { PROGRAM_PREFIX } from "../wcat/names.js"
import { processShell, type Shell } from "./land.js"
import { binNames } from "./wcat-lint.js"

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

/** `new` writes 0.0.0, so a pull request raising it is the first release; no override in lint/ reaches this check. */
export const firstReleaseProblems = (baseVersion: string, pkg: { name?: unknown; bin?: unknown }): string[] =>
  baseVersion === "0.0.0" && !binNames(pkg).some((command) => command.startsWith(PROGRAM_PREFIX))
    ? [
        `the first release installs no ${PROGRAM_PREFIX}<name> command: add "${PROGRAM_PREFIX}<name>" to package.json ` +
          '"bin", beside the short name if it keeps one, and call wcatStart first in the bin (WC-CMD-29)',
      ]
    : []

export interface LiveRecord {
  version: string
  commit: string
  date: string
  script: string
  tree: string
}

/** A squash merge drops the checked commit from main, so a record names the checked files, not only the commit. */
export const liveTree = (shell: Shell): string | undefined => {
  const listing = shell.run("git", ["ls-tree", "HEAD", "--", ...LIVE_PATHS])
  return listing.ok ? createHash("sha256").update(listing.out).digest("hex") : undefined
}

export const parseLiveRecords = (text: string): LiveRecord[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [version = "", commit = "", date = "", script = "", tree = ""] = line.split(/\s+/)
      return { version, commit, date, script, tree }
    })

export const liveCheckProblems = (shell: Shell, records: readonly LiveRecord[], version: string): string[] => {
  const record = records.findLast((entry) => entry.version === version)
  if (!record)
    return [
      `no live check recorded for ${version} in ${LIVE_FILE}: run the live check, then ` +
        "`cli-dev live record --script <its script>` and commit the line in the release pull request",
    ]
  if (record.tree)
    return liveTree(shell) === record.tree
      ? []
      : [
          `${LIVE_PATHS.join(", ")} changed since ${version}'s live check at ${record.commit.slice(0, 12)}: ` +
            "check the code that is released, and record it again",
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
  const file = resolve(io.cwd, values.file)
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
    io.err(`commit ${LIVE_PATHS.join(", ")} first: a record names the code that was checked`)
    return 1
  }
  const commit = shell.run("git", ["rev-parse", "HEAD"]).out
  const tree = liveTree(shell)
  if (!tree) {
    io.err(`git could not list ${LIVE_PATHS.join(", ")} at HEAD`)
    return 1
  }
  const date = (io.now?.() ?? new Date()).toISOString().slice(0, 10)
  const line = `${version} ${commit} ${date} ${values.script} ${tree}`
  appendFileSync(
    file,
    `${existsSync(file) ? "" : "# version commit date script tree — one line per passed live check\n"}${line}\n`,
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
  const version = packageVersion(io.cwd)
  const pkg = JSON.parse(readFileSync(join(io.cwd, "package.json"), "utf8")) as { name?: unknown; bin?: unknown }
  const problems = [
    ...releasePrProblems(readFileSync(resolve(io.cwd, values.body), "utf8"), baseVersion, version),
    ...(baseVersion === version ? [] : firstReleaseProblems(baseVersion, pkg)),
  ]
  for (const problem of problems) io.err(problem)
  if (problems.length === 0) io.out("release pull request: ok")
  return problems.length > 0 ? 1 : 0
}

const REQUIRED_RULES = ["deletion", "non_fast_forward", "pull_request", "required_status_checks"]

/** The checks cli-template's workflows report on a pull request; `conformance` comes from its release-pr.yml. */
export const REQUIRED_CHECKS = [
  "standards",
  "changelog / guard",
  "validation / ci / check",
  "validation / ci / bun",
  "validation / ci / secrets",
  "validation / prose",
  "validation / version",
  "validation / node-22",
  "validation / repo-setup",
]

type GhRead = { ok: true; json: unknown } | { ok: false; problems: string[]; skipped?: string; status?: string }

const FREE_PLAN = "Upgrade to GitHub Pro or make this repository public"

/** `skipped` when GitHub could not be asked (no gh, no login, no network): the caller says so and goes on. */
const ghRead = (shell: Shell, path: string, what: string): GhRead => {
  const answer = shell.run("gh", ["api", path])
  if (answer.ok) {
    try {
      return { ok: true, json: JSON.parse(answer.out) }
    } catch {
      return { ok: false, problems: [], skipped: "gh did not answer JSON" }
    }
  }
  const status = answer.out.match(/HTTP (\d{3})/)?.[1]
  if (status === "401" || (!status && /gh auth login|GH_TOKEN/.test(answer.out)))
    return { ok: false, problems: [], skipped: "gh is not signed in (set GH_TOKEN in CI)" }
  if (!status)
    return { ok: false, problems: [], skipped: `GitHub could not be reached: ${answer.out.split("\n")[0] ?? ""}` }
  // A private repository on the free plan has no rulesets or environments (NEED-2331).
  if (status === "403" && answer.out.includes(FREE_PLAN))
    return { ok: false, status, problems: [], skipped: "a private repository on GitHub's free plan has none" }
  return {
    ok: false,
    status,
    problems: [
      `GitHub answered ${status} for ${what}: ` +
        (answer.out.match(/gh: ([^\n]*?) \(HTTP/)?.[1] ?? "the repository is missing or this token cannot read it"),
    ],
  }
}

export const rulesetProblems = (
  shell: Shell,
  slug: string,
  checks: readonly string[] = REQUIRED_CHECKS,
): { problems: string[]; skipped?: string } => {
  const read = ghRead(shell, `repos/${slug}/rules/branches/main`, `${slug}'s rules on main`)
  if (!read.ok) return read
  type Rule = { type?: string; parameters?: { required_status_checks?: { context?: string }[] } }
  const rules = Array.isArray(read.json) ? (read.json as Rule[]) : []
  const types = rules.map((rule) => String(rule.type))
  const missing = REQUIRED_RULES.filter((rule) => !types.includes(rule))
  if (missing.length > 0)
    return { problems: [`main's ruleset lacks ${missing.join(", ")} (cli-base docs/standards/new-cli.md, step 1)`] }
  const required = new Set(
    rules.flatMap((rule) => rule.parameters?.required_status_checks?.map((check) => check.context) ?? []),
  )
  const absent = checks.filter((check) => !required.has(check))
  return absent.length === 0
    ? { problems: [] }
    : {
        problems: [
          `main's ruleset does not require ${absent.join(", ")}: add them to its required status checks ` +
            "(cli-base docs/standards/new-cli.md, step 1)",
        ],
      }
}

/** npm trusts release.yml by name, so only `main` may run the job that holds the npm environment's token. */
export const environmentProblems = (shell: Shell, slug: string): { problems: string[]; skipped?: string } => {
  const environment = ghRead(shell, `repos/${slug}/environments/npm`, `${slug}'s npm environment`)
  if (!environment.ok)
    return environment.status === "404"
      ? { problems: [], skipped: "the repository has no npm environment, so it does not publish yet" }
      : environment
  const policy = (environment.json as { deployment_branch_policy?: Record<string, unknown> | null })
    .deployment_branch_policy
  const limit = `limit the npm environment's deployment branches to main (cli-base docs/standards/new-cli.md, step 2)`
  if (policy?.custom_branch_policies !== true || policy.protected_branches !== false)
    return { problems: [`any branch can deploy to npm: ${limit}`] }
  const branches = ghRead(
    shell,
    `repos/${slug}/environments/npm/deployment-branch-policies`,
    `${slug}'s npm deployment branches`,
  )
  if (!branches.ok) return branches
  const names = ((branches.json as { branch_policies?: { name?: string; type?: string }[] }).branch_policies ?? []).map(
    (entry) => `${entry.type ?? "branch"}:${entry.name}`,
  )
  return names.length === 1 && names[0] === "branch:main"
    ? { problems: [] }
    : { problems: [`the npm environment deploys from ${names.join(", ") || "no branch"}, not only main: ${limit}`] }
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
  const checks =
    read(".github/workflows/release-pr.yml") === undefined ? REQUIRED_CHECKS : [...REQUIRED_CHECKS, "conformance"]
  const ruleset = rulesetProblems(shell, slug, checks)
  if (ruleset.skipped) io.err(`repo-check: ruleset not checked — ${ruleset.skipped}`)
  const environment = environmentProblems(shell, slug)
  if (environment.skipped) io.err(`repo-check: npm environment not checked — ${environment.skipped}`)
  const problems = [
    ...ruleset.problems,
    ...environment.problems,
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
                                       appends "<version> <commit> <date> <script> <tree>" to ${LIVE_FILE}
                                       after a live check passed; <tree> hashes the committed src/,
                                       package.json and lockfile, which must be committed
  live check [--version <x.y.z>] [--file <path>]
                                       fails unless that version has a record and src/, package.json
                                       and the lockfile are the ones it hashed; needs no commit object,
                                       so a squash-merged release branch passes
  repo-check --cli <name> [--groups <file>]
                                       main's ruleset and its required checks, the npm environment
                                       limited to main (through gh; skipped without a login or network),
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
