// Fails a pull request that breaks the changelog rules, from the title and the two commits:
//
//   node scripts/changelog-guard.ts "<PR title>" <base sha> <head sha>
//
// 1. A title marked breaking (`feat!:`, `fix(watch)!:`) adds a line under the unreleased heading.
// 2. A section whose version is already tagged `v<version>` is not edited. A dated heading alone does
//    not mean released: a release is dated in a pull request, merged, and tagged only after npm has it,
//    and that window still takes changelog fixes. An incorrect historical section may only be restored to its tag.
//    Only a title with the `release` or `changelog` scope adds lines to a dated section the base already had: a
//    rebase onto a just-dated release moves a feature's new entries there silently, and bin/release folds Unreleased
//    into the dated version only if it still publishes this commit.
// 3. No `###` heading repeats inside a section the pull request leaves untagged: an entry belongs under the
//    section's existing heading. Only a repeat the base did not have fails, so an old one does not block others.
import { execFileSync } from "node:child_process"

type Sections = Map<string, string[]>

const BREAKING_TITLE = /^\w+(\([^)]*\))?!:/
const CHANGELOG_TITLE = /^\w+\((release|changelog)\)!?:/
const UNRELEASED = /^## (Unreleased|Не выпущено)\s*$/i
const DATED = /^## v?(\d+\.\d+\.\d+\S*) [—–-] \S/

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

  if (!BREAKING_TITLE.test(input.title)) return undefined
  const unreleased = (all: Sections) => [...all].find(([heading]) => UNRELEASED.test(heading))?.[1] ?? []
  const old = new Set(unreleased(base))
  if (!unreleased(head).some((line) => line.trim() !== "" && !old.has(line)))
    return `CHANGELOG.md: a breaking title ("${input.title}") needs an entry under the unreleased heading`
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
  const show = (sha: string) => {
    try {
      return git("show", `${sha}:CHANGELOG.md`)
    } catch {
      return ""
    }
  }
  const message = checkChangelog({
    title,
    base: show(mergeBase),
    head: show(headSha),
    tags: git("tag", "--list", "v*").split("\n").filter(Boolean),
    releasedText: (version) => {
      try {
        return git("show", `v${version}:CHANGELOG.md`)
      } catch {
        return undefined
      }
    },
  })
  if (message) {
    console.error(message)
    process.exit(1)
  }
  console.log("changelog guard: ok")
}

if (import.meta.main) main()
