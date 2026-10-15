// Fails a pull request that breaks the changelog rules, from the title and the two commits:
//
//   node scripts/changelog-guard.ts "<PR title>" <base sha> <head sha>
//
// 1. A title marked breaking (`feat!:`, `fix(watch)!:`) adds a line under the unreleased heading.
// 2. A section whose version is already tagged `v<version>` is not edited. A dated heading alone does
//    not mean released: a release is dated in a pull request, merged, and tagged only after npm has it,
//    and that window still takes changelog fixes.
import { execFileSync } from "node:child_process"

type Sections = Map<string, string[]>

const BREAKING_TITLE = /^\w+(\([^)]*\))?!:/
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
}): string | undefined {
  const repeated = duplicateHeading(input.head)
  if (repeated) return `CHANGELOG.md: duplicate heading for ${repeated}; keep one section per version`
  const base = sections(input.base)
  const head = sections(input.head)
  const tagged = new Set(input.tags.map((tag) => tag.replace(/^v/, "")))

  for (const [heading, body] of base) {
    const version = DATED.exec(heading)?.[1]
    if (!version || !tagged.has(version)) continue
    if (head.get(heading)?.join("\n").trim() !== body.join("\n").trim())
      return `CHANGELOG.md: "${heading}" is already released (tag v${version}); put the change under the unreleased heading`
  }

  if (!BREAKING_TITLE.test(input.title)) return undefined
  const unreleased = (all: Sections) => [...all].find(([heading]) => UNRELEASED.test(heading))?.[1] ?? []
  const before = new Set(unreleased(base))
  if (!unreleased(head).some((line) => line.trim() !== "" && !before.has(line)))
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
  })
  if (message) {
    console.error(message)
    process.exit(1)
  }
  console.log("changelog guard: ok")
}

if (import.meta.main) main()
