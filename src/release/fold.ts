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
