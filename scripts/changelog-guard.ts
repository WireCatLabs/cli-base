// Fails a pull request that breaks the changelog rules, from the title and the two commits:
//
//   node scripts/changelog-guard.ts "<PR title>" <base sha> <head sha>
//
// 1. A title marked breaking (`feat!:`, `fix(watch)!:`) adds a line under the unreleased heading, or adds or edits a
//    changelog fragment, `changes/<name>.md`, which the repository's release collects into its version's section.
// 2. A section whose version is already tagged `v<version>` is not edited. A dated heading alone does
//    not mean released: a release is dated in a pull request, merged, and tagged only after npm has it,
//    and that window still takes changelog fixes. An incorrect historical section may only be restored to its tag.
//    Only a title with the `release` or `changelog` scope adds lines to a dated section the base already had: a
//    rebase onto a just-dated release moves a feature's new entries there silently, and bin/release folds Unreleased
//    into the dated version only if it still publishes this commit.
// 3. No `###` heading repeats inside a section the pull request leaves untagged: an entry belongs under the
//    section's existing heading. Only a repeat the base did not have fails, so an old one does not block others.
// 4. A change to a stable API report, `api/<entry>.api.txt` (`cli-dev api-report`), has its changelog heading among the
//    entries the pull request adds: a removed or changed line needs "Changed — may break callers" or "Removed", an
//    added one "Added". A report the base did not have is a first one and needs nothing.
// 5. From 1.0.0 on, a pull request that adds a stable break ("Changed — may break callers", "Removed") carries the
//    `major` label: it waits for a major the owner chose (WC-REL-7).
import { execFileSync } from "node:child_process"

type Sections = Map<string, string[]>

const BREAKING_TITLE = /^\w+(\([^)]*\))?!:/
const CHANGELOG_TITLE = /^\w+\((release|changelog)\)!?:/
const UNRELEASED = /^## (Unreleased|Не выпущено)\s*$/i
const DATED = /^## v?(\d+\.\d+\.\d+\S*) [—–-] \S/
export const FRAGMENTS = /^changes\/(?!README\.md$)[^/]+\.md$/
export const API_REPORTS = /^api\/[^/]+\.api\.txt$/
const BREAKS = ["Changed — may break callers", "Removed"]

export type ApiReport = { path: string; base?: string; head: string }

/** The `###` headings with an entry the pull request adds, in a fragment or under the unreleased heading. */
function addedHeadings(base: Sections, head: Sections, fragments: readonly string[]): Set<string> {
  const found = new Set<string>()
  const scan = (lines: readonly string[], fresh: (line: string) => boolean) => {
    let heading: string | undefined
    for (const line of lines) {
      if (line.startsWith("### ")) heading = line.slice(4).trim()
      else if (heading && line.trim() !== "" && !line.startsWith("#") && fresh(line)) found.add(heading)
    }
  }
  for (const text of fragments) scan(text.split("\n"), () => true)
  const unreleased = (all: Sections) => [...all].find(([heading]) => UNRELEASED.test(heading))?.[1] ?? []
  const old = new Set(unreleased(base))
  scan(unreleased(head), (line) => !old.has(line))
  return found
}

/** Lines of `from` that `to` has fewer of; a report's lines repeat (`}`), so they are counted, not just looked up. */
function missingLines(from: string, to: string): string[] {
  const left = new Map<string, number>()
  for (const line of to.split("\n")) left.set(line, (left.get(line) ?? 0) + 1)
  return from.split("\n").filter((line) => {
    if (line.trim() === "" || line.startsWith("#")) return false
    const count = left.get(line) ?? 0
    left.set(line, count - 1)
    return count <= 0
  })
}

function apiProblem(reports: readonly ApiReport[], added: Set<string>): string | undefined {
  for (const { path, base, head } of reports) {
    if (base === undefined) continue
    const removed = missingLines(base, head)
    if (removed.length > 0 && !BREAKS.some((heading) => added.has(heading)))
      return `${path}: the stable API lost or changed "${removed[0]}"; add an entry under "Changed — may break callers" or "Removed" (WC-REL-7)`
    if (removed.length === 0 && missingLines(head, base).length > 0 && !added.has("Added"))
      return `${path}: the stable API gained names; add an entry under "Added" (WC-REL-7)`
  }
  return undefined
}

function duplicateHeading(text: string): string | undefined {
  const seen = new Set<string>()
  for (const line of text.split("\n")) {
    const version = DATED.exec(line)?.[1] ?? (UNRELEASED.test(line) ? "unreleased" : undefined)
    if (!version) continue
    if (seen.has(version)) return version
    seen.add(version)
  }
  return undefined
}

function repeatedSubheadings(all: Sections, tagged: Set<string>): Set<string> {
  const repeats = new Set<string>()
  for (const [heading, body] of all) {
    const version = DATED.exec(heading)?.[1]
    if (version && tagged.has(version)) continue
    const seen = new Set<string>()
    for (const line of body.filter((line) => line.startsWith("### "))) {
      if (seen.has(line)) repeats.add(`"${line.slice(4)}" twice in "${heading.slice(3)}"`)
      seen.add(line)
    }
  }
  return repeats
}

function sections(text: string): Sections {
  const found: Sections = new Map()
  let current: string[] | undefined
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      current = []
      found.set(line.trimEnd(), current)
    } else current?.push(line.trimEnd())
  }
  return found
}

export function checkChangelog(input: {
  title: string
  base: string
  head: string
  tags: string[]
  releasedText?: (version: string) => string | undefined
  /** The text of each `changes/*.md` fragment the pull request adds or edits. */
  fragments?: string[]
  /** Each `api/<entry>.api.txt` the pull request changes; `base` is absent for a new one. */
  api?: ApiReport[]
  /** The head's package.json version and the pull request's labels, for the `major` label rule. */
  version?: string
  labels?: string[]
}): string | undefined {
  const repeated = duplicateHeading(input.head)
  if (repeated) return `CHANGELOG.md: duplicate heading for ${repeated}; keep one section per version`
  const base = sections(input.base)
  const head = sections(input.head)
  const tagged = new Set(input.tags.map((tag) => tag.replace(/^v/, "")))

  for (const [heading, body] of base) {
    const version = DATED.exec(heading)?.[1]
    if (!version || !tagged.has(version)) continue
    if (head.get(heading)?.join("\n").trim() !== body.join("\n").trim()) {
      const taggedText = input.releasedText?.(version)
      const original =
        taggedText === undefined
          ? undefined
          : [...sections(taggedText)].find(([name]) => DATED.exec(name)?.[1] === version)
      if (!original || head.get(original[0])?.join("\n").trim() !== original[1].join("\n").trim())
        return `CHANGELOG.md: "${heading}" is already released (tag v${version}); put the change under the unreleased heading`
    }
  }

  if (!CHANGELOG_TITLE.test(input.title)) {
    for (const [heading, body] of head) {
      const version = DATED.exec(heading)?.[1]
      const old = base.get(heading)
      if (!version || tagged.has(version) || !old) continue
      const kept = new Set(old)
      if (body.some((line) => line.trim() !== "" && !kept.has(line)))
        return `CHANGELOG.md: "${heading}" is dated for release; put the entry under the unreleased heading, and the release folds it in (only a \`release\` or \`changelog\` scope adds to a dated section)`
    }
  }

  const before = repeatedSubheadings(base, tagged)
  const repeat = [...repeatedSubheadings(head, tagged)].find((found) => !before.has(found))
  if (repeat) return `CHANGELOG.md: ${repeat}; put the entry under the heading that is already there`

  const added = addedHeadings(base, head, input.fragments ?? [])
  const api = apiProblem(input.api ?? [], added)
  if (api) return api
  const major = Number((input.version ?? "0").split(".")[0])
  if (major >= 1 && BREAKS.some((heading) => added.has(heading)) && !input.labels?.includes("major"))
    return `a stable break ("Changed — may break callers" or "Removed") needs a major: add the \`major\` label, and the pull request waits for the next major (WC-REL-7)`

  if (!BREAKING_TITLE.test(input.title)) return undefined
  const entry = (line: string) => line.trim() !== "" && !line.startsWith("#")
  if (input.fragments?.some((text) => text.split("\n").some(entry))) return undefined
  const unreleased = (all: Sections) => [...all].find(([heading]) => UNRELEASED.test(heading))?.[1] ?? []
  const old = new Set(unreleased(base))
  if (!unreleased(head).some((line) => line.trim() !== "" && !old.has(line)))
    return `CHANGELOG.md: a breaking title ("${input.title}") needs a line under the unreleased heading or in changes/`
  return undefined
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}

function main() {
  const [title = "", baseSha = "", headSha = ""] = process.argv.slice(2)
  if (!baseSha || !headSha) {
    console.error("usage: changelog-guard.ts <PR title> <base sha> <head sha>")
    process.exit(2)
  }
  const mergeBase = git("merge-base", baseSha, headSha).trim()
  const shown = (sha: string, path: string) => {
    try {
      return git("show", `${sha}:${path}`)
    } catch {
      return undefined
    }
  }
  const show = (sha: string) => shown(sha, "CHANGELOG.md") ?? ""
  const fragments = git("diff", "--name-only", "--diff-filter=AM", mergeBase, headSha, "--", "changes")
    .split("\n")
    .filter((path) => FRAGMENTS.test(path))
    .map((path) => git("show", `${headSha}:${path}`))
  const api = git("diff", "--name-only", mergeBase, headSha, "--", "api")
    .split("\n")
    .filter((path) => API_REPORTS.test(path))
    .map((path) => ({ path, base: shown(mergeBase, path), head: shown(headSha, path) ?? "" }))
  let labels: string[] = []
  try {
    labels = JSON.parse(process.env.LABELS || "[]")
  } catch {}
  const message = checkChangelog({
    title,
    fragments,
    api,
    labels,
    version: JSON.parse(shown(headSha, "package.json") ?? "{}").version,
    base: show(mergeBase),
    head: show(headSha),
    tags: git("tag", "--list", "v*").split("\n").filter(Boolean),
    releasedText: (version) => shown(`v${version}`, "CHANGELOG.md"),
  })
  if (message) {
    console.error(message)
    process.exit(1)
  }
  console.log("changelog guard: ok")
}

if (import.meta.main) main()
