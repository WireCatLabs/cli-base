// Checks the standards handbook in docs/standards/: rule ids, their "Enforced by" lines, and the index.
//
//   node scripts/standards-ids.ts        (after `pnpm build`: the rule names come from dist/)
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type Handbook = { index: string; pages: ReadonlyMap<string, string> }

const RULE_HEADING = /^###\s+(WC-([A-Z]+)-(\d+))\s+·\s+\S/
const ENFORCED = /\*\*Enforced by:\*\*\s*(.*)$/
const REVIEW_ONLY = /^review only\.?$/i
const INDEX_ROW = /^\|\s*\[[^\]]+\]\(([\w-]+\.md)\)\s*\|\s*`?([A-Z]+|—)`?\s*\|/

const withoutFences = (text: string) =>
  text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (block) => block.replace(/[^\n]/g, ""))

export const standardsProblems = ({ index, pages }: Handbook, known: ReadonlySet<string>): string[] => {
  const problems: string[] = []
  const areas = new Map<string, string>()
  for (const line of withoutFences(index).split("\n")) {
    const row = INDEX_ROW.exec(line)
    if (row?.[1] && row[2]) areas.set(row[1], row[2])
  }

  const seen = new Map<string, string>()
  for (const [name, text] of pages) {
    const area = areas.get(name)
    if (area === undefined) problems.push(`${name}: not linked from the index`)
    let last = 0
    let open: string | undefined
    const close = () => {
      if (open) problems.push(`${name}: ${open} has no "Enforced by" line`)
      open = undefined
    }
    withoutFences(text)
      .split("\n")
      .forEach((line, index) => {
        const where = `${name}:${index + 1}`
        if (/^#{1,3}\s/.test(line)) close()
        const heading = RULE_HEADING.exec(line)
        if (heading) {
          const [, id = "", prefix, number] = heading
          if (area !== undefined && prefix !== area) problems.push(`${where}: ${id} is not in this page's area ${area}`)
          const earlier = seen.get(id)
          if (earlier) problems.push(`${where}: ${id} is also at ${earlier}`)
          else seen.set(id, where)
          if (Number(number) <= last) problems.push(`${where}: ${id} comes after a higher number`)
          last = Math.max(last, Number(number))
          open = id
          return
        }
        if (/^#{1,6}\s+WC-/.test(line)) problems.push(`${where}: a rule heading is "### WC-<AREA>-<n> · <title>"`)
        const enforced = ENFORCED.exec(line)?.[1]?.trim()
        if (enforced === undefined) return
        if (!open) {
          problems.push(`${where}: "Enforced by" outside a rule`)
          return
        }
        open = undefined
        if (REVIEW_ONLY.test(enforced)) return
        const names = [...enforced.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "")
        if (names.length === 0) problems.push(`${where}: "Enforced by" names no check — name one or say "review only"`)
        for (const check of names)
          if (!known.has(check))
            problems.push(`${where}: "${check}" is not a known check — name one or say "review only"`)
      })
    close()
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
): Set<string> => {
  const known = new Set([...rules.LINT_RULES, ...rules.AUDIT_RULES].map((rule) => rule.id))
  const workflows = join(root, ".github/workflows")
  for (const file of readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name))) {
    known.add(file)
    for (const job of jobsOf(readFileSync(join(workflows, file), "utf8"))) known.add(`${file}:${job}`)
  }
  const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {}
  for (const script of Object.keys(scripts)) known.add(`pnpm ${script}`)
  return known
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
  const dist = join(root, "dist/standards/index.js")
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
