type Section = { title: string; headings: Map<string, string[]>; repeated: boolean }

const trimBlank = (lines: string[]) => {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start]?.trim()) start++
  while (end > start && !lines[end - 1]?.trim()) end--
  return lines.slice(start, end)
}

const parseSection = (block: string): Section => {
  const [title = "", ...lines] = block.split("\n")
  const chunks = new Map<string, string[][]>()
  let current: string[] | undefined
  for (const line of lines) {
    if (line.startsWith("### ")) {
      const heading = line.slice(4).trim()
      current = []
      chunks.set(heading, [...(chunks.get(heading) ?? []), current])
    } else if (current) current.push(line)
    else if (line.trim()) throw new Error(`"${title}" has text before its first ### heading: "${line}"`)
  }
  const headings = new Map([...chunks].map(([heading, bodies]) => [heading, bodies.flatMap(trimBlank)]))
  return { title, headings, repeated: [...chunks.values()].some((bodies) => bodies.length > 1) }
}

const render = (title: string, sections: Section[]) => {
  const merged = new Map<string, string[]>()
  for (const section of sections)
    for (const [heading, body] of section.headings) merged.set(heading, [...(merged.get(heading) ?? []), ...body])
  const body = [...merged]
    .filter(([, lines]) => lines.length > 0)
    .map(([heading, lines]) => `### ${heading}\n\n${lines.join("\n")}\n`)
    .join("\n")
  return `${title}\n\n${body}`
}

/**
 * Folds the unreleased section into the one below it when that one is `## <version> — `: one session
 * dates the version, another adds the unreleased section above it before anyone publishes. Same-named
 * `###` headings merge, the unreleased entries first; the dated section keeps its date. `undefined` when
 * the top is not the unreleased section above that version. The caller makes sure the version is not on
 * npm: a published section must never take new entries.
 */
export const foldUnreleased = (text: string, version: string, unreleased = "Unreleased"): string | undefined => {
  const [preamble, top, next, ...rest] = text.split(/\n(?=## )/)
  if (top !== `## ${unreleased}` && !top?.startsWith(`## ${unreleased}\n`)) return undefined
  if (!next?.startsWith(`## ${version} — `)) return undefined
  return [preamble, render(next.split("\n")[0] ?? "", [parseSection(top), parseSection(next)]), ...rest].join("\n")
}

/**
 * Merges same-named `###` headings in the top section when it is `## <version> — `. A pull request
 * branched before a fold still adds under the unreleased heading; git applies that hunk under the dated
 * heading that replaced it, beside the section's own copy (cli-core 0.294.0, 2026-10-15). `undefined`
 * when no heading repeats there. The caller makes sure the version is not on npm.
 */
export const mergeRepeatedHeadings = (text: string, version: string): string | undefined => {
  const [preamble, top, ...rest] = text.split(/\n(?=## )/)
  if (!top?.startsWith(`## ${version} — `)) return undefined
  const section = parseSection(top)
  if (!section.repeated) return undefined
  return [preamble, render(section.title, [section]), ...rest].join("\n")
}

const body = (block: string) =>
  block
    .split("\n")
    .slice(1)
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()

const entries = (section: Section) =>
  [...section.headings].flatMap(([heading, lines]) => {
    const found: { heading: string; text: string }[] = []
    for (const line of lines) {
      if (!line.trim()) continue
      const last = found.at(-1)
      if (line.startsWith("- ") || !last) found.push({ heading, text: line })
      else last.text += `\n${line}`
    }
    return found
  })

/** The `## <version> — ` section of a changelog, or `undefined` when it has none. */
export const taggedSection = (text: string, version: string) =>
  text.split(/\n(?=## )/).find((block) => block.startsWith(`## ${version} — `))

/**
 * Puts the section of `version`, the newest tagged one, back to its text in that tag. A pull request
 * checked before the version was dated or tagged and merged after it adds its entry there with no
 * guard to see it, though that code ships only in the next version: each such entry moves to the unreleased
 * section, after its entries under the same `###` heading. `undefined` when the section matches the tag the
 * way the changelog guard compares them, or when the tag's changelog has no section for `version`: nothing was
 * released under that heading, so there is nothing to restore.
 */
export const restoreReleased = (
  text: string,
  tagText: string,
  version: string,
  unreleased = "Unreleased",
): { text: string; moved: string[] } | undefined => {
  const dated = (block: string) => block.startsWith(`## ${version} — `)
  const tagged = taggedSection(tagText, version)
  if (!tagged) return undefined
  const blocks = text.split(/\n(?=## )/)
  const index = blocks.findIndex(dated)
  if (index < 0) throw new Error(`no "## ${version} — " section to compare with the v${version} tag`)
  const current = blocks[index] ?? ""
  if (current.split("\n")[0]?.trimEnd() === tagged.split("\n")[0]?.trimEnd() && body(current) === body(tagged))
    return undefined

  const shipped = new Set(entries(parseSection(tagged)).map((entry) => entry.text))
  const missed = entries(parseSection(current)).filter((entry) => !shipped.has(entry.text))
  blocks[index] = tagged.replace(/\n+$/, current.endsWith("\n") ? "\n" : "")
  if (missed.length > 0) {
    const headings = new Map<string, string[]>()
    for (const { heading, text: entry } of missed) headings.set(heading, [...(headings.get(heading) ?? []), entry])
    const moved: Section = { title: "", headings, repeated: false }
    const top = blocks[1]
    const open = top === `## ${unreleased}` || top?.startsWith(`## ${unreleased}\n`)
    const section = render(`## ${unreleased}`, open && top ? [parseSection(top), moved] : [moved])
    blocks.splice(1, open ? 1 : 0, section)
  }
  return { text: blocks.join("\n"), moved: missed.map((entry) => entry.text.split("\n")[0] ?? "") }
}
