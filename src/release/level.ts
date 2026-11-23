/**
 * The version level a changelog section needs. `Added`, `Deprecated` and `Changed — experimental` need a minor; a
 * break of the stable API (`Changed — may break callers`, `Removed`) a major from 1.0.0 on, a minor before it.
 */
const LEVELS = ["patch", "minor", "major"] as const
type Level = (typeof LEVELS)[number]

const PLAIN = /^\d+\.\d+\.\d+$/
// `1.0.0-rc.1` counts as 1.0.0: the pre-release tail never makes a number of its own.
const parse = (version: string) => (version.split("-")[0] ?? "").split(".").map(Number)

const raised = (from: string, to: string): Level => {
  const [a = 0, b = 0] = parse(from)
  const [x = 0, y = 0] = parse(to)
  if (x !== a) return "major"
  return y !== b ? "minor" : "patch"
}

const needed = (version: string, section: string): Level => {
  if (/^### (Changed — may break callers|Removed)$/m.test(section))
    return (parse(version)[0] ?? 0) >= 1 ? "major" : "minor"
  return /^### (Added|Deprecated|Changed — experimental)$/m.test(section) ? "minor" : "patch"
}

const raise = (from: string, level: Level) => {
  const [a = 0, b = 0, c = 0] = parse(from)
  if (level === "major") return `${a + 1}.0.0`
  return level === "minor" ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`
}

const later = (x: string, y: string) => {
  const [a, b] = [parse(x), parse(y)]
  const i = a.findIndex((n, k) => n !== b[k])
  return i === -1 || (a[i] ?? 0) > (b[i] ?? 0) ? x : y
}

/** The top section and the last plain release below it: a release candidate in between is not a release. */
const sections = (changelog: string) => {
  const [top, ...below] = [...changelog.matchAll(/^## (\S+).*$/gm)]
  const previous = below.find((one) => PLAIN.test(one[1] ?? ""))
  const next = below[0]
  if (!top || !previous?.[1] || !next) return undefined
  return { version: top[1], previous: previous[1], section: changelog.slice(top.index, next.index) }
}

// The next free number on npm is a patch; the top section may need a minor or major over the version below it.
export const levelledVersion = (changelog: string, next: string): string => {
  const parts = sections(changelog)
  if (!parts || !PLAIN.test(next)) return next
  return later(next, raise(parts.previous, needed(next, parts.section)))
}

export const versionLevelProblem = (changelog: string): string | undefined => {
  const parts = sections(changelog)
  if (!parts?.version || !PLAIN.test(parts.version)) return undefined
  const { version, previous, section } = parts
  const want = needed(version, section)
  const got = raised(previous, version)
  if (LEVELS.indexOf(got) >= LEVELS.indexOf(want)) return undefined
  return `${version} raises the ${got} version over ${previous}, but its changelog needs a ${want} release`
}
