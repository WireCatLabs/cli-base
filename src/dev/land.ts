import { readFileSync, writeFileSync } from "node:fs"
import spawn from "cross-spawn"
import { foldUnreleased, mergeRepeatedHeadings, restoreReleased } from "../release/index.js"

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

/** Moves the entries that missed the newest tagged version to the unreleased section; see `restoreReleased`. */
export const restoreChange = (
  text: string,
  tagText: string,
  version: string,
  unreleased: string,
): Change | undefined => {
  const restored = restoreReleased(text, tagText, version, unreleased)
  if (!restored) return undefined
  const moved = restored.moved.map((entry) => `\n${entry}`).join("")
  return {
    text: restored.text,
    title: `chore(release): restore ${version}'s notes to its tag`,
    body:
      `bin/release: CHANGELOG.md's ${version} section differed from the v${version} tag. It now matches the tag` +
      (moved
        ? `, and ${restored.moved.length} entr${restored.moved.length === 1 ? "y" : "ies"} that missed ${version} ` +
          `moved to ${unreleased}:${moved}`
        : ".") +
      "\nOnly CHANGELOG.md changes.",
    line: `restored ${version}'s notes to its tag${moved ? `; moved to ${unreleased}:${moved}` : ""}`,
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

/** Lands the changelog fold on `main` through a pull request; see `landChange`. */
export const landFold = ({ file, version, unreleased, shell, log }: LandOptions): string | undefined =>
  landChange({
    file,
    branch: `release/fold-${version}`,
    change: (text) => changelogChange(text, version, unreleased),
    done: `main already has ${version}'s changelog folded`,
    shell,
    log,
  })

/**
 * Lands a changelog change on `main` through a pull request. Each attempt computes it on a fresh
 * `origin/main`; a pull request that main has since moved under (another session landed first, or
 * merged a change to CHANGELOG.md) is closed and the change redone once. Returns the line to print, or
 * `undefined` when there was nothing to change. Throws when it cannot land.
 */
export const landChange = ({
  file,
  branch,
  change: changeOf,
  done,
  shell,
  log,
}: {
  file: string
  branch: string
  change: (text: string) => Change | undefined
  done: string
  shell: Shell
  log: (text: string) => void
}): string | undefined => {
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
  const abandon = (pr: string) => {
    log(`${pr} no longer merges into main — closing it and folding again on the new main`)
    must("gh", "pr", "close", pr, "--delete-branch")
    shell.run("git", ["branch", "-q", "-D", branch])
  }

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    must("git", "fetch", "-q", "origin")
    must("git", "merge", "-q", "--ff-only", "origin/main")
    const change = changeOf(readFileSync(file, "utf8"))
    if (!change) {
      if (attempt > 1) log(`${done} — nothing to land`)
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
  throw new Error(`main moved under ${branch} twice — run bin/release again`)
}

/**
 * The newest `v<x.y.z>` tag in this commit's history and the changelog at it. Tags are fetched first: a clone made before the
 * last release does not have its tag, and comparing against an older one would hide the newest drift.
 */
export const newestTag = (shell: Shell, path: string): { version: string; text: string } => {
  const fetched = shell.run("git", ["fetch", "-q", "--tags", "origin"])
  if (!fetched.ok) throw new Error(`git fetch --tags failed: ${fetched.out}`)
  const [version] = shell
    .run("git", ["tag", "--list", "v*", "--merged", "HEAD"])
    .out.split("\n")
    .map((tag) => /^v(\d+\.\d+\.\d+)$/.exec(tag.trim())?.[1])
    .filter((found): found is string => found !== undefined)
    .sort((a, b) => {
      const [x, y] = [a, b].map((found) => found.split(".").map(Number))
      return (y?.[0] ?? 0) - (x?.[0] ?? 0) || (y?.[1] ?? 0) - (x?.[1] ?? 0) || (y?.[2] ?? 0) - (x?.[2] ?? 0)
    })
  if (!version) throw new Error("no v<x.y.z> tag to compare the changelog with")
  const shown = shell.run("git", ["show", `v${version}:${path}`])
  if (!shown.ok) throw new Error(`git show v${version}:${path} failed: ${shown.out}`)
  return { version, text: shown.out }
}
