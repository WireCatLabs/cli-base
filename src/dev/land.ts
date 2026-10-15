import { readFileSync, writeFileSync } from "node:fs"
import spawn from "cross-spawn"
import { foldUnreleased, mergeRepeatedHeadings } from "../release/index.js"

export interface Shell {
  run: (command: string, args: readonly string[]) => { ok: boolean; out: string }
  sleep: (ms: number) => void
}

export const processShell = (cwd: string): Shell => ({
  run: (command, args) => {
    const result = spawn.sync(command, [...args], { cwd, encoding: "utf8" })
    return { ok: result.status === 0, out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() }
  },
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
})

export type Change = { text: string; title: string; body: string; line: string }

export const changelogChange = (text: string, version: string, unreleased: string): Change | undefined => {
  const folded = foldUnreleased(text, version, unreleased)
  if (folded !== undefined)
    return {
      text: folded,
      title: `chore(release): fold ${unreleased} into ${version}`,
      body: `bin/release: ${version} is dated but not on npm, and ${unreleased} sat above it. Only CHANGELOG.md changes.`,
      line: `folded ${unreleased} into ${version}`,
    }
  const merged = mergeRepeatedHeadings(text, version)
  if (merged === undefined) return undefined
  return {
    text: merged,
    title: `chore(release): merge repeated headings in ${version}`,
    body:
      `bin/release: ${version} is dated but not on npm, and a ### heading repeated in its section — a pull ` +
      "request branched before a fold added under the old heading. Only CHANGELOG.md changes.",
    line: `merged repeated headings in ${version}`,
  }
}

export interface LandOptions {
  file: string
  version: string
  unreleased: string
  shell: Shell
  log: (text: string) => void
}

const ATTEMPTS = 2

/**
 * Lands the changelog fold on `main` through a pull request. Each attempt folds on a fresh
 * `origin/main`; a pull request that main has since moved under (another session folded first, or
 * merged a change to CHANGELOG.md) is closed and the fold redone once. Returns the line to print, or
 * `undefined` when there was nothing to fold. Throws when it cannot land.
 */
export const landFold = ({ file, version, unreleased, shell, log }: LandOptions): string | undefined => {
  const must = (command: string, ...args: string[]) => {
    const result = shell.run(command, args)
    if (!result.ok) throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed: ${result.out}`)
    return result.out
  }
  const mergeable = (pr: string) => {
    for (let i = 0; i < 30; i++) {
      const state = shell.run("gh", ["pr", "view", pr, "--json", "mergeable", "--jq", ".mergeable"]).out
      if (state === "MERGEABLE" || state === "CONFLICTING") return state
      shell.sleep(2000)
    }
    return "UNKNOWN"
  }
  const branch = `release/fold-${version}`
  const abandon = (pr: string) => {
    log(`${pr} no longer merges into main — closing it and folding again on the new main`)
    must("gh", "pr", "close", pr, "--delete-branch")
    shell.run("git", ["branch", "-q", "-D", branch])
  }

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    must("git", "fetch", "-q", "origin")
    must("git", "merge", "-q", "--ff-only", "origin/main")
    const change = changelogChange(readFileSync(file, "utf8"), version, unreleased)
    if (!change) {
      if (attempt > 1) log(`main already has ${version}'s changelog folded — nothing to land`)
      return undefined
    }
    writeFileSync(file, change.text)
    must("git", "switch", "-q", "-C", branch)
    must("git", "commit", "-q", "-m", change.title, "-m", change.body, "--", file)
    must("git", "push", "-q", "--force", "-u", "origin", branch)
    must("git", "switch", "-q", "main")
    const pr = must(
      "gh",
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      change.title,
      "--body",
      change.body,
    )
    // A conflicting pull request gets no checks, so the conflict is looked for before waiting on them.
    if (mergeable(pr) === "CONFLICTING") {
      abandon(pr)
      continue
    }
    for (let i = 0; i < 30; i++) {
      if (Number(shell.run("gh", ["pr", "checks", pr, "--json", "name", "--jq", "length"]).out) > 0) break
      shell.sleep(2000)
    }
    if (!shell.run("gh", ["pr", "checks", pr, "--watch", "--fail-fast"]).ok)
      throw new Error(`checks failed on ${pr} — nothing is published`)
    const subject = `${change.title} (#${pr.split("/").pop()})`
    if (!shell.run("gh", ["pr", "merge", pr, "--squash", "--delete-branch", "--subject", subject]).ok) {
      if (mergeable(pr) !== "CONFLICTING") throw new Error(`${pr} did not merge — nothing is published`)
      abandon(pr)
      continue
    }
    must("git", "fetch", "-q", "origin")
    must("git", "merge", "-q", "--ff-only", "origin/main")
    return `${change.line} (${pr})`
  }
  throw new Error(`main moved under the fold twice — run bin/release again`)
}
