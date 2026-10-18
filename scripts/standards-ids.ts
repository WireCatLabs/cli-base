// Checks the standards handbook in docs/standards/: rule ids, their "Enforced by" lines, and the index.
//
//   node scripts/standards-ids.ts        (after `pnpm build`: the rule names come from dist/)
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type Handbook = { index: string; pages: ReadonlyMap<string, string> }
export type KnownChecks = { has: (name: string) => boolean }

// Checks in these repositories cannot be read from here, so only the shape `<repo>: <check>` is checked.
export const OTHER_REPOSITORIES: readonly string[] = [
  "<app>",
  "cli-core",
  "cli-docs",
  "cli-memo",
  "cli-testing",
  "community",
  "drive-cli",
  "max-cli",
  "tg-cli",
  "whatsapp-cli",
  "zoom-cli",
]

const RULE_HEADING = /^###\s+(WC-([A-Z]+)-(\d+))\s+·\s+(\S.*)$/
const POINTER = /^(?:Moved to|Merged into)\s+\[?(WC-[A-Z]+-\d+)\]?/
const ENFORCED = /\*\*Enforced by:\*\*\s*(.*)$/
const CONTINUATION = /^\s{2,}(?!-\s)\S/
const REVIEW_ONLY = /^review only\.?$/i
const INDEX_ROW = /^\|\s*\[[^\]]+\]\(([\w-]+\.md)\)\s*\|\s*`?([A-Z]+|—)`?\s*\|\s*([^|]*?)\s*\|/
const CROSS_REPO = /^(\S+): (.*)$/

const withoutFences = (text: string) =>
  text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (block) => block.replace(/[^\n]/g, ""))

const checkProblem = (check: string, known: KnownChecks): string | undefined => {
  if (known.has(check)) return undefined
  const cross = CROSS_REPO.exec(check)
  if (!cross) return `"${check}" is not a known check — name one or say "review only"`
  const [, repository = "", name = ""] = cross
  if (!OTHER_REPOSITORIES.includes(repository))
    return `"${check}" names an unknown repository "${repository}" — use one of ${OTHER_REPOSITORIES.join(", ")}`
  if (name.trim() === "") return `"${check}" names no check after "${repository}:"`
  return undefined
}

export const standardsProblems = ({ index, pages }: Handbook, known: KnownChecks): string[] => {
  const problems: string[] = []
  const areas = new Map<string, string>()
  const counts = new Map<string, number>()
  for (const line of withoutFences(index).split("\n")) {
    const row = INDEX_ROW.exec(line)
    if (!row?.[1] || !row[2]) continue
    areas.set(row[1], row[2])
    if (/^\d+$/.test(row[3] ?? "")) counts.set(row[1], Number(row[3]))
  }

  const seen = new Map<string, string>()
  const live = new Set<string>()
  const pointers: { id: string; target: string; where: string }[] = []
  for (const [name, text] of pages) {
    const area = areas.get(name)
    if (area === undefined) problems.push(`${name}: not linked from the index`)
    let last = 0
    let rules = 0
    let open: string | undefined
    const close = () => {
      if (open) problems.push(`${name}: ${open} has no "Enforced by" line`)
      open = undefined
    }
    const lines = withoutFences(text).split("\n")
    for (let at = 0; at < lines.length; at++) {
      const line = lines[at] ?? ""
      const where = `${name}:${at + 1}`
      if (/^#{1,3}\s/.test(line)) close()
      const heading = RULE_HEADING.exec(line)
      if (heading) {
        const [, id = "", prefix, number, title = ""] = heading
        if (area !== undefined && prefix !== area) problems.push(`${where}: ${id} is not in this page's area ${area}`)
        const earlier = seen.get(id)
        if (earlier) problems.push(`${where}: ${id} is also at ${earlier}`)
        else seen.set(id, where)
        if (Number(number) <= last) problems.push(`${where}: ${id} comes after a higher number`)
        last = Math.max(last, Number(number))
        const target = POINTER.exec(title)?.[1]
        if (target) pointers.push({ id, target, where })
        else {
          live.add(id)
          rules++
          open = id
        }
        continue
      }
      if (/^#{1,6}\s+WC-/.test(line)) problems.push(`${where}: a rule heading is "### WC-<AREA>-<n> · <title>"`)
      let enforced = ENFORCED.exec(line)?.[1]
      if (enforced === undefined) continue
      while (CONTINUATION.test(lines[at + 1] ?? "")) enforced += ` ${(lines[++at] ?? "").trim()}`
      enforced = enforced.trim()
      if (!open) {
        problems.push(`${where}: "Enforced by" outside a rule`)
        continue
      }
      open = undefined
      if (REVIEW_ONLY.test(enforced)) continue
      const names = [...enforced.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "")
      if (names.length === 0) problems.push(`${where}: "Enforced by" names no check — name one or say "review only"`)
      for (const check of names) {
        const problem = checkProblem(check, known)
        if (problem) problems.push(`${where}: ${problem}`)
      }
    }
    close()
    const listed = counts.get(name)
    if (listed !== undefined && listed !== rules)
      problems.push(`${name}: the index counts ${listed} rules, the page has ${rules}`)
  }

  for (const { id, target, where } of pointers) {
    if (target === id) problems.push(`${where}: ${id} points at itself`)
    else if (!live.has(target)) problems.push(`${where}: ${id} points at ${target}, which is not a rule`)
  }
  return problems
}

const jobsOf = (workflow: string) => {
  const jobs: string[] = []
  let inJobs = false
  for (const line of workflow.split("\n")) {
    if (/^\S/.test(line)) inJobs = line.startsWith("jobs:")
    const job = inJobs ? /^ {2}([\w-]+):\s*$/.exec(line)?.[1] : undefined
    if (job) jobs.push(job)
  }
  return jobs
}

export const knownChecks = (
  root: string,
  rules: { LINT_RULES: readonly { id: string }[]; AUDIT_RULES: readonly { id: string }[] },
): KnownChecks => {
  const known = new Set([...rules.LINT_RULES, ...rules.AUDIT_RULES].map((rule) => rule.id))
  const workflows = join(root, ".github/workflows")
  for (const file of readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name))) {
    known.add(file)
    for (const job of jobsOf(readFileSync(join(workflows, file), "utf8"))) known.add(`${file}:${job}`)
  }
  const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {}
  for (const script of Object.keys(scripts)) known.add(`pnpm ${script}`)
  // A test or source file in this repository, named by its path, is a check when it exists.
  const isFile = (name: string) => /^[\w.-]+(\/[\w.-]+)+$/.test(name) && existsSync(join(root, name))
  return { has: (name) => known.has(name) || isFile(name) }
}

export const readHandbook = (root: string): Handbook => {
  const directory = join(root, "docs/standards")
  const pages = new Map<string, string>()
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".md") && file !== "README.md"))
    pages.set(name, readFileSync(join(directory, name), "utf8"))
  return { index: readFileSync(join(directory, "README.md"), "utf8"), pages }
}

async function main() {
  const root = join(import.meta.dirname, "..")
  const dist = join(root, "dist/standards/tables.js")
  if (!existsSync(dist)) {
    console.error("standards: run `pnpm build` first — the rule names come from dist/")
    process.exit(2)
  }
  const rules = await import(dist)
  const problems = standardsProblems(readHandbook(root), knownChecks(root, rules))
  for (const problem of problems) console.error(problem)
  if (problems.length > 0) process.exit(1)
  console.log("standards: ok")
}

if (import.meta.main) await main()
