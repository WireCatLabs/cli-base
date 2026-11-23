/**
 * The stable API of a package, as text a pull request diffs: `package.json`'s `wirecat.stable` names the stable entry
 * points, and inside them a declaration whose TSDoc says `@experimental` is left out. Read from the emitted `.d.ts`
 * with a small scanner, because TypeScript 7 ships no compiler API to walk them with.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"
import spawn from "cross-spawn"
import type { DevIo } from "./main.js"
import { declarationOf, STRINGS_AND_COMMENTS, typesIn } from "./result-shape.js"

export const API_REPORT_USAGE = `  api-report [--check] [--skip-build]
                                       builds the package, then writes api/<entry>.api.txt for each
                                       entry point package.json lists in "wirecat.stable", without
                                       the names whose TSDoc says @experimental; --check fails when a
                                       committed report differs. Does nothing without that list`

export const API_DIR = "api"
export const API_SUFFIX = ".api.txt"

interface Statement {
  text: string
  doc: string
}

interface Name {
  kinds: string[]
  lines: string[]
  experimental: boolean
}

interface Module {
  exports: Map<string, Name>
}

const skipLiteral = (source: string, at: number): number => {
  const char = source[at]
  if (char === "/" && source[at + 1] === "*") {
    const end = source.indexOf("*/", at + 2)
    return end < 0 ? source.length : end + 2
  }
  if (char === "/" && source[at + 1] === "/") {
    const end = source.indexOf("\n", at)
    return end < 0 ? source.length : end
  }
  if (char === '"' || char === "'" || char === "`") {
    let end = at + 1
    while (end < source.length && source[end] !== char) end += source[end] === "\\" ? 2 : 1
    return end + 1
  }
  return at
}

const BLOCK =
  /^(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:interface|class|enum|const\s+enum|namespace)\b/

/** Top-level statements with the `/** … *\/` comment right before each. */
export const statementsOf = (source: string): Statement[] => {
  const found: Statement[] = []
  let doc = ""
  let at = 0
  while (at < source.length) {
    if (/\s/.test(source[at] as string)) {
      at += 1
      continue
    }
    const skipped = skipLiteral(source, at)
    if (skipped > at && source[at] === "/") {
      if (source.startsWith("/**", at)) doc = source.slice(at, skipped)
      at = skipped
      continue
    }
    const start = at
    const block = BLOCK.test(source.slice(start, start + 200))
    let depth = 0
    for (; at < source.length; at += 1) {
      const past = skipLiteral(source, at)
      if (past > at) {
        at = past - 1
        continue
      }
      const char = source[at] as string
      if ("{([".includes(char)) depth += 1
      else if ("})]".includes(char)) {
        depth -= 1
        // A body closes at the end of its line; a `}` inside generics (`<T extends { a: 1 }>`) does not.
        if (depth === 0 && char === "}" && block && /^[ \t]*(?:\n|$)/.test(source.slice(at + 1, at + 80))) {
          at += 1
          break
        }
      } else if (char === ";" && depth === 0) {
        at += 1
        break
      }
    }
    found.push({ text: source.slice(start, at), doc })
    doc = ""
  }
  return found
}

const linesOf = (text: string): string[] =>
  text
    .replace(STRINGS_AND_COMMENTS, (match) => (match.startsWith("/") ? "" : match))
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line !== "" && !/^(?:private\b|#private\b)/.test(line))

const EXPERIMENTAL = /@experimental\b/
const DECLARATION =
  /^(export\s+)?(?:declare\s+)?(?:abstract\s+)?(const\s+enum|const|let|var|function|class|interface|type|enum|namespace)\s+([\w$]+)/
const STAR = /^export\s+\*\s+from\s*["']([^"']+)["']/
const LIST = /^export\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/

const merge = (into: Name | undefined, add: Name): Name =>
  into === undefined
    ? { kinds: [...add.kinds], lines: [...add.lines], experimental: add.experimental }
    : {
        kinds: [...new Set([...into.kinds, ...add.kinds])].sort(),
        lines: [...into.lines, ...add.lines],
        experimental: into.experimental || add.experimental,
      }

/** The exports of one `.d.ts` file; a non-exported local a declaration names is reported with it. */
const moduleOf = (file: string, cache: Map<string, Module>, problems: string[]): Module => {
  const cached = cache.get(file)
  if (cached) return cached
  const module: Module = { exports: new Map() }
  cache.set(file, module)
  const locals = new Map<string, Name>()
  const exported = new Set<string>()
  const lists: { statement: Statement; flat: string }[] = []
  for (const statement of statementsOf(readFileSync(file, "utf8"))) {
    const lines = linesOf(statement.text)
    const flat = lines.join(" ")
    if (flat === "" || /^import\b/.test(flat) || /^export\s*\{\s*\}\s*;?$/.test(flat)) continue
    const declared = DECLARATION.exec(flat)
    if (declared) {
      const [, isExported, kind = "", name = ""] = declared
      const add = { kinds: [kind.replace(/\s+/g, " ")], lines, experimental: EXPERIMENTAL.test(statement.doc) }
      locals.set(name, merge(locals.get(name), add))
      if (isExported) exported.add(name)
    } else if (STAR.test(flat) || LIST.test(flat)) lists.push({ statement, flat })
    else problems.push(`${file}: cli-dev api-report cannot read "${flat.slice(0, 80)}"`)
  }
  const withLocals = (name: string): Name => {
    const own = locals.get(name) as Name
    const lines = [...own.lines]
    const seen = new Set([name])
    for (let at = 0; at < lines.length; at += 1)
      for (const [word] of (lines[at] as string).matchAll(/[\w$]+/g)) {
        const local = locals.get(word)
        if (local === undefined || seen.has(word) || exported.has(word)) continue
        seen.add(word)
        for (const line of local.lines) lines.push(line)
      }
    return { ...own, lines }
  }
  for (const name of exported) module.exports.set(name, withLocals(name))
  for (const { statement, flat } of lists) {
    const marked = EXPERIMENTAL.test(statement.doc)
    const star = STAR.exec(flat)?.[1]
    const [, items = "", from = star] = LIST.exec(flat) ?? []
    const target = from?.startsWith(".") ? declarationOf(dirname(file), from) : undefined
    if (from?.startsWith(".") && target === undefined) {
      problems.push(`${file}: no declaration file for "${from}"`)
      continue
    }
    const source = target ? moduleOf(target, cache, problems).exports : undefined
    if (star !== undefined) {
      if (!source) problems.push(`${file}: cli-dev api-report cannot follow "export * from ${star}"`)
      for (const [name, found] of source ?? [])
        module.exports.set(name, { ...found, experimental: found.experimental || marked })
      continue
    }
    for (const item of items
      .split(",")
      .map((one) => one.trim().replace(/^type\s+/, ""))
      .filter(Boolean)) {
      const [original = "", alias = original] = item.split(/\s+as\s+/)
      const found =
        from === undefined ? (locals.has(original) ? withLocals(original) : undefined) : source?.get(original)
      if (from !== undefined && !source) {
        module.exports.set(alias, {
          kinds: ["re-export"],
          lines: [`export { ${item} } from "${from}"`],
          experimental: marked,
        })
        continue
      }
      if (found === undefined) {
        problems.push(`${file}: exports "${original}", which ${from ?? "the file"} does not declare`)
        continue
      }
      module.exports.set(alias, { ...found, experimental: found.experimental || marked })
    }
  }
  return module
}

export const reportFileOf = (entry: string): string =>
  `${API_DIR}/${entry === "." ? "index" : entry.replace(/^\.\//, "").replaceAll("/", "-")}${API_SUFFIX}`

/** The stable entry points `package.json` lists, or undefined when it lists none (the package opted out). */
export const stableEntries = (pkg: Record<string, unknown>): unknown =>
  (pkg.wirecat as { stable?: unknown } | undefined)?.stable

/**
 * One report per stable entry point, keyed by its path under `api/`: `<name> · <kind> · <line>` for each line of each
 * stable declaration, sorted by name, so a pull request that removes or changes a stable name shows a removed line.
 */
export const apiReports = (cwd: string): { files: Map<string, string>; problems: string[] } => {
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as Record<string, unknown>
  const stable = stableEntries(pkg)
  const files = new Map<string, string>()
  const problems: string[] = []
  if (!Array.isArray(stable) || !stable.every((entry) => typeof entry === "string"))
    return {
      files,
      problems: ['package.json: "wirecat.stable" must be a list of "exports" keys, such as [".", "./http"]'],
    }
  const exports = (typeof pkg.exports === "object" && pkg.exports !== null ? pkg.exports : {}) as Record<
    string,
    unknown
  >
  const cache = new Map<string, Module>()
  for (const entry of stable) {
    if (!(entry in exports)) {
      problems.push(`package.json: "wirecat.stable" lists "${entry}", which is not an "exports" key`)
      continue
    }
    const [types] = typesIn(exports[entry], typeof exports[entry] === "string" ? "types" : undefined).filter((path) =>
      path.endsWith(".d.ts"),
    )
    if (types === undefined) {
      problems.push(`package.json: stable entry "${entry}" has no "types" file to report on`)
      continue
    }
    const file = join(cwd, types)
    if (!existsSync(file)) {
      problems.push(`${types} is not built: build the package before cli-dev api-report`)
      continue
    }
    const names = [...moduleOf(file, cache, problems).exports]
      .filter(([, name]) => !name.experimental)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const lines = names.flatMap(([name, { kinds, lines }]) =>
      lines.map((line) => `${name} · ${kinds.join("+")} · ${line}`),
    )
    const header = `# ${String(pkg.name)} "${entry}": the stable API, written by cli-dev api-report. Do not edit.`
    files.set(reportFileOf(entry), `${[header, ...lines].join("\n")}\n`)
  }
  return { files, problems }
}

const report = (io: DevIo, problems: readonly string[], ok: string) => {
  for (const problem of problems) io.err(problem)
  if (problems.length > 0) return 1
  io.out(ok)
  return 0
}

/** The stable API report under api/: written, or with `--check` compared with the committed one. */
export const apiReportCommand = (args: string[], io: DevIo): number => {
  const { values } = parseArgs({
    args,
    options: { check: { type: "boolean", default: false }, "skip-build": { type: "boolean", default: false } },
  })
  const pkg = JSON.parse(readFileSync(join(io.cwd, "package.json"), "utf8")) as Record<string, unknown>
  if (stableEntries(pkg) === undefined) {
    io.out('package.json lists no "wirecat.stable" entry points: no API report')
    return 0
  }
  if (!values["skip-build"]) {
    const manager = String(pkg.packageManager ?? "npm").split("@")[0] || "npm"
    const built = spawn.sync(manager, ["run", "build"], { cwd: io.cwd, stdio: ["ignore", "inherit", "inherit"] })
    if (built.status !== 0) {
      io.err(`${manager} run build failed: the API report reads the built .d.ts files`)
      return 1
    }
  }
  const { files, problems } = apiReports(io.cwd)
  if (problems.length > 0) return report(io, problems, "")
  const dir = join(io.cwd, API_DIR)
  const committed = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(API_SUFFIX)) : []
  const stale = committed.map((name) => `${API_DIR}/${name}`).filter((path) => !files.has(path))
  if (values.check) {
    const differ = [...files].filter(([path, text]) => {
      const file = join(io.cwd, path)
      return !existsSync(file) || readFileSync(file, "utf8") !== text
    })
    return report(
      io,
      [
        ...differ.map(([path]) => `${path} differs from the build: run cli-dev api-report and commit it`),
        ...stale.map((path) => `${path} reports no stable entry point any more: run cli-dev api-report`),
      ],
      `${API_DIR}/: ${files.size} API reports match the build`,
    )
  }
  mkdirSync(dir, { recursive: true })
  for (const [path, text] of files) writeFileSync(join(io.cwd, path), text)
  for (const path of stale) rmSync(join(io.cwd, path))
  io.out(`${API_DIR}/: wrote ${files.size} API reports${stale.length > 0 ? `, removed ${stale.join(", ")}` : ""}`)
  return 0
}
