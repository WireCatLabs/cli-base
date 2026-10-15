type Section = { title: string; headings: Map<string, string[]> }

const trimBlank = (lines: string[]) => {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start]?.trim()) start++
  while (end > start && !lines[end - 1]?.trim()) end--
  return lines.slice(start, end)
}

const parseSection = (block: string): Section => {
  const [title = "", ...lines] = block.split("\n")
  const headings = new Map<string, string[]>()
  let current: string[] | undefined
  for (const line of lines) {
    if (line.startsWith("### ")) {
      current = headings.get(line.slice(4)) ?? []
      headings.set(line.slice(4), current)
    } else if (current) current.push(line)
    else if (line.trim()) throw new Error(`"${title}" has text before its first ### heading: "${line}"`)
  }
  for (const [heading, body] of headings) headings.set(heading, trimBlank(body))
  return { title, headings }
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
  const merged = new Map<string, string[]>()
  for (const section of [parseSection(top), parseSection(next)])
    for (const [heading, body] of section.headings) merged.set(heading, [...(merged.get(heading) ?? []), ...body])
  const body = [...merged]
    .filter(([, lines]) => lines.length > 0)
    .map(([heading, lines]) => `### ${heading}\n\n${lines.join("\n")}\n`)
    .join("\n")
  return [preamble, `${next.split("\n")[0]}\n\n${body}`, ...rest].join("\n")
}
