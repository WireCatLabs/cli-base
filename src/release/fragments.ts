/**
 * Changelog fragments: each pull request adds `changes/<branch>.md` instead of editing `## Unreleased`, so open
 * pull requests do not conflict in CHANGELOG.md. A release collects them into the version's section and deletes
 * them in the release commit (`cli-dev changelog fragments`). Moved here from b24 and cli-core, which kept copies.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { idPattern } from "./markdown.js"

export type Fragment = { name: string; text: string }

/** The changelog's `###` headings in the WireCat CLIs, in their order. */
export const CHANGELOG_HEADINGS = ["Added", "Changed — may break callers", "Fixed", "Security", "Removed"] as const
export type FragmentRules = { headings: readonly string[]; ids: readonly string[] }

const NAME = /^[a-z0-9][a-z0-9._-]*\.md$/

export const readFragments = (root: string): Fragment[] => {
  const directory = join(root, "changes")
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => ({ name: entry.name, text: readFileSync(join(directory, entry.name), "utf8") }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
}

export const fragmentProblems = ({ name, text }: Fragment, { headings, ids }: FragmentRules): string[] => {
  const file = `changes/${name}`
  const id = idPattern(ids)
  const problems: string[] = []
  if (!NAME.test(name)) problems.push(`${file}: name it changes/<branch>.md in lower case, "/" as "-"`)
  const entries = new Map<string, number>()
  let heading: string | undefined
  text.split("\n").forEach((line, index) => {
    const where = `${file}:${index + 1}`
    if (line.startsWith("### ")) {
      heading = line.slice(4).trim()
      if (!headings.includes(heading)) problems.push(`${where}: "${heading}" is not one of: ${headings.join(", ")}`)
      if (entries.has(heading)) problems.push(`${where}: "${heading}" twice`)
      entries.set(heading, 0)
      return
    }
    if (line.startsWith("#")) problems.push(`${where}: only "### <heading>" headings; the release adds the version`)
    if (!line.trim()) return
    if (heading === undefined) problems.push(`${where}: text before the first ### heading`)
    else entries.set(heading, (entries.get(heading) ?? 0) + 1)
    for (const found of line.match(id) ?? []) problems.push(`${where}: internal id ${found} — say what changed instead`)
  })
  if (entries.size === 0) problems.push(`${file}: no "### <heading>" with an entry under it`)
  for (const [found, count] of entries) if (count === 0) problems.push(`${file}: "${found}" has no entry`)
  return problems
}

const trimBlank = (lines: string[]) => {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start]?.trim()) start++
  while (end > start && !lines[end - 1]?.trim()) end--
  return lines.slice(start, end)
}

const byHeading = (lines: string[], where: string) => {
  const found = new Map<string, string[]>()
  let current: string[] | undefined
  for (const line of lines) {
    if (line.startsWith("### ")) {
      const heading = line.slice(4).trim()
      current = found.get(heading) ?? []
      found.set(heading, current)
    } else if (current) current.push(line)
    else if (line.trim()) throw new Error(`${where} has text before its first ### heading: "${line}"`)
  }
  return new Map([...found].map(([heading, body]) => [heading, trimBlank(body)]))
}

/**
 * Adds every fragment's entries under the same-named heading of `## <version> — `, after the entries already there,
 * fragments in name order. A fragment links from `changes/`, so `../` is dropped for CHANGELOG.md at the root.
 */
export const collectFragments = (
  changelog: string,
  version: string,
  fragments: Fragment[],
  { headings }: Pick<FragmentRules, "headings">,
): string => {
  const parts = changelog.split(/\n(?=## )/)
  const index = parts.findIndex((part) => part.startsWith(`## ${version} — `))
  const section = parts[index]
  if (section === undefined) throw new Error(`CHANGELOG.md has no "## ${version} — " section to collect changes/ into`)
  const [title = "", ...lines] = section.split("\n")
  const merged = byHeading(lines, title)
  for (const fragment of fragments) {
    const text = fragment.text.replace(/\]\(\.\.\//g, "](")
    for (const [heading, body] of byHeading(text.split("\n"), `changes/${fragment.name}`))
      merged.set(heading, [...(merged.get(heading) ?? []), ...body])
  }
  const rank = (heading: string) => (headings.includes(heading) ? headings.indexOf(heading) : headings.length)
  const body = [...merged]
    .filter(([, entries]) => entries.length > 0)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([heading, entries]) => `### ${heading}\n\n${entries.join("\n")}\n`)
    .join("\n")
  parts[index] = `${title}\n\n${body}`
  return parts.join("\n")
}
