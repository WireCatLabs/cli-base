import { readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { parseArgs } from "node:util"
import { levelledVersion, versionLevelProblem } from "../release/level.js"
import type { DevIo } from "./main.js"

/**
 * The version `bin/release` publishes: the one in package.json when npm has not taken it and it is
 * above npm's latest, else the next free one at the same bump level (x.0.0 → major from 1.0.0 on, x.y.0 → minor,
 * x.y.z → patch).
 * npm's answers are arguments, not calls, so CI and a test can hand it any registry state.
 */
export const nextVersion = (
  wanted: string,
  latest: string,
  versionsJson: string,
): { version: string } | { error: string } => {
  const parse = (version: string) => /^(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number)
  const compare = (a: number[], b: number[]) =>
    (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0)

  const want = parse(wanted)
  // A pre-release is picked by hand; bin/release still refuses it if npm has it.
  if (!want) return { version: wanted }

  let published: unknown[] = []
  try {
    published = [JSON.parse(versionsJson || "[]")].flat()
  } catch {}
  const taken = new Set(published)

  const top = parse(latest)
  if (!top) {
    if (taken.has(wanted))
      return { error: `${wanted} is on npm, and npm's latest "${latest}" is not a plain x.y.z version` }
    return { version: wanted }
  }

  if (!taken.has(wanted) && compare(want, top) > 0) return { version: wanted }

  // A taken x.0.0 stays a major: 2.0.0 taken goes to 3.0.0, never to 2.1.0.
  const step = ([major = 0, minor = 0, patch = 0]: number[]) =>
    want[1] === 0 && want[2] === 0 && (want[0] ?? 0) >= 1
      ? [major + 1, 0, 0]
      : want[2] === 0
        ? [major, minor + 1, 0]
        : [major, minor, patch + 1]
  let next = step(top)
  while (taken.has(next.join("."))) next = step(next)
  return { version: next.join(".") }
}

/** The top section's version level: with `--next <x.y.z>`, the version it needs; without, whether it has it. */
export const levelCommand = (args: string[], io: DevIo): number => {
  const { values } = parseArgs({
    args,
    options: { next: { type: "string" }, file: { type: "string", default: "CHANGELOG.md" } },
  })
  const text = readFileSync(isAbsolute(values.file) ? values.file : join(io.cwd, values.file), "utf8")
  if (values.next) {
    io.out(levelledVersion(text, values.next))
    return 0
  }
  const problem = versionLevelProblem(text)
  if (problem) io.err(problem)
  else io.out(`${values.file}: the top section's version fits its headings`)
  return problem ? 1 : 0
}
