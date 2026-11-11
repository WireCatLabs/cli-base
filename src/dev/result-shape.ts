import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import type { SourceFile } from "./network.js"

/** The `.d.ts` files a package publishes, followed from its `exports`; `missing` are declared but not built. */
export interface Declarations {
  files: readonly SourceFile[]
  missing: readonly string[]
}

const typesIn = (value: unknown, key?: string): string[] => {
  if (typeof value === "string") return key === "types" || key === "typings" ? [value] : []
  if (Array.isArray(value)) return value.flatMap((one) => typesIn(one))
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([at, one]) => typesIn(one, at))
  return []
}

const RELATIVE_MODULE = /(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g

const declarationOf = (dir: string, specifier: string): string | undefined => {
  const base = join(dir, specifier)
  const candidates = /\.[cm]?js$/.test(base)
    ? [base.replace(/\.(c|m)?js$/, ".d.$1ts")]
    : [`${base}.d.ts`, join(base, "index.d.ts")]
  return candidates.find((path) => existsSync(path))
}

/** Every declaration file reachable from the package's `types` entries, by their relative imports. */
export const readDeclarations = (cwd: string): Declarations => {
  const manifest = join(cwd, "package.json")
  if (!existsSync(manifest)) return { files: [], missing: [] }
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>
  const entries = [
    ...new Set(
      typesIn({ types: pkg.types, typings: pkg.typings, exports: pkg.exports }).filter((path) => !path.includes("*")),
    ),
  ]
  const missing = entries.filter((path) => !existsSync(join(cwd, path)))
  const read = new Map<string, string>()
  const queue = entries.map((path) => join(cwd, path)).filter((path) => existsSync(path))
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (read.has(file)) continue
    const text = readFileSync(file, "utf8")
    read.set(file, text)
    for (const [, specifier] of text.matchAll(RELATIVE_MODULE)) {
      const next = declarationOf(dirname(file), specifier as string)
      if (next !== undefined && !read.has(next)) queue.push(next)
    }
  }
  const files = [...read]
    .map(([path, text]) => ({ path: relative(cwd, path).split("\\").join("/"), text }))
    .sort((a, b) => (a.path < b.path ? -1 : 1))
  return { files, missing }
}

const STRINGS_AND_COMMENTS = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g
const OPEN = "([{<"
const CLOSE = ")]}>"

/** Brackets of every kind count, and the `>` of `=>` closes nothing. */
const depthStep = (text: string, at: number): number => {
  const char = text[at] as string
  if (char === ">" && text[at - 1] === "=") return 0
  return OPEN.includes(char) ? 1 : CLOSE.includes(char) ? -1 : 0
}

/** The index just past the bracket that closes the one at `from`. */
const closing = (text: string, from: number): number => {
  let depth = 0
  for (let at = from; at < text.length; at += 1) {
    depth += depthStep(text, at)
    if (depth === 0) return at + 1
  }
  return text.length
}

const splitTop = (text: string, separators: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let at = 0; at < text.length; at += 1) {
    depth += depthStep(text, at)
    if (depth === 0 && separators.includes(text[at] as string)) {
      parts.push(text.slice(start, at))
      start = at + 1
    }
  }
  return [...parts, text.slice(start)].map((part) => part.trim()).filter((part) => part !== "")
}

const objectsIn = (type: string): string[] => {
  const found: string[] = []
  for (let at = 0; at < type.length; at += 1)
    if (type[at] === "{") {
      const end = closing(type, at)
      found.push(type.slice(at + 1, end - 1))
      at = end - 1
    }
  return found
}

interface Member {
  name: string
  type: string
  /** A method's or function's parameters; absent on a property. */
  params?: string
}

const skipGenerics = (text: string) => (text.startsWith("<") ? text.slice(closing(text, 0)).trimStart() : text)

/** `(a: A) => R` as its parameters and `R`; undefined for any other type. */
const arrowOf = (type: string): { params: string; returns: string } | undefined => {
  const rest = skipGenerics(type)
  if (!rest.startsWith("(")) return undefined
  const end = closing(rest, 0)
  const after = rest.slice(end).trimStart()
  return after.startsWith("=>") ? { params: rest.slice(1, end - 1), returns: after.slice(2).trim() } : undefined
}

const memberOf = (raw: string): Member | undefined => {
  const text = raw.replace(/^(?:(?:readonly|static|public|protected|private|abstract|declare|get|set)\s+)+/, "")
  const name = text.match(/^[\w$]+\??/)?.[0]
  if (name === undefined) return undefined
  const rest = skipGenerics(text.slice(name.length).trimStart())
  const bare = name.replace(/\?$/, "")
  if (rest.startsWith("(")) {
    const end = closing(rest, 0)
    return { name: bare, params: rest.slice(1, end - 1), type: rest.slice(end).trim().replace(/^:/, "").trim() }
  }
  if (!rest.startsWith(":")) return undefined
  const type = rest.slice(1).trim()
  const arrow = arrowOf(type)
  return arrow ? { name: bare, params: arrow.params, type: arrow.returns } : { name: bare, type }
}

const unwrapPromise = (type: string): string => {
  const inner = type.match(/^Promise\s*</)
  return inner && closing(type, inner[0].length - 1) === type.length ? type.slice(inner[0].length, -1).trim() : type
}

const isArray = (type: string): boolean => {
  const bare = type.trim().replace(/^readonly\s+/, "")
  if (splitTop(bare, "|&").length !== 1) return false
  if (/^(?:Readonly)?Array\s*</.test(bare)) return closing(bare, bare.indexOf("<")) === bare.length
  return bare.endsWith("[]")
}

const LISTY_NAME = /^(?:list|search|find)(?:[A-Z]|$)|[a-z](?:List|Search)$/
const PAGE_NUMBER = /\bpage\??\s*:\s*number\b/

/** A list or search that takes a limit, an offset or a page pages; one that takes none may return everything. */
const isPaged = ({ name, params = "" }: Member, pagingTypes: ReadonlySet<string>) =>
  LISTY_NAME.test(name) &&
  (/\b(?:limit|offset|page)\b/.test(params) || [...params.matchAll(/[\w$]+/g)].some(([word]) => pagingTypes.has(word)))

const PAGING_KEYS = new Set([
  "hasMore",
  "has_more",
  "limit_reached",
  "limitReached",
  "nextOffset",
  "next_offset",
  "nextPage",
  "next_page",
])
/** A declaration or member named like a page of a list or a search. */
const RESULT_NAME = /^(?:list|search|history)(?:[A-Z]|$)|(?:Found|Page|Results?|List|Hits)$/

const renameOf = ({ name, type }: Member): string | undefined => {
  if (name === "has_more" || name === "limit_reached" || name === "limitReached") return "hasMore"
  if (name === "next_offset") return "nextOffset"
  if (name === "nextPage" || name === "next_page") return /\bstring\b/.test(type) ? "nextCursor" : "nextOffset"
  return undefined
}

/** `inherits`: an interface that extends another may get `items` and `hasMore` from it. */
const pageFixes = (members: readonly Member[], label: string, inherits: boolean): string[] => {
  const props = members.filter((member) => member.params === undefined)
  const names = new Set(props.map((member) => member.name))
  const lists = props.filter((member) => isArray(member.type))
  const paged = lists.length > 0 && props.some((member) => PAGING_KEYS.has(member.name))
  if (!paged || !RESULT_NAME.test(label.split(".").at(-1) ?? "")) return []
  return [
    ...(names.has("items") || inherits
      ? []
      : [`name the rows \`items\` (now ${lists.map((member) => member.name).join(", ")})`]),
    ...props.flatMap((member) => {
      const now = renameOf(member)
      return now ? [`rename \`${member.name}\` to \`${now}\``] : []
    }),
    ...([...names].some((name) => renameOf({ name, type: "" }) === "hasMore") || names.has("hasMore") || inherits
      ? []
      : ["add `hasMore`"]),
  ]
}

export interface ShapeFinding {
  target: string
  message: string
}

const STANDARD = "return ListResult<T> from @wirecat/cli-base/standards (WC-OUT-25)"

interface Scan {
  found: ShapeFinding[]
  /** Types that declare a `limit` or an `offset`: a parameter of one of them pages. */
  pagingTypes: Set<string>
}

const visitObject = (body: string, label: string, scan: Scan, inherits = false) => {
  const members = splitTop(body, ";,").flatMap((raw) => memberOf(raw) ?? [])
  if (!label.includes(".") && members.some(({ name }) => name === "limit" || name === "offset"))
    scan.pagingTypes.add(label)
  const fixes = pageFixes(members, label, inherits)
  if (fixes.length > 0) scan.found.push({ target: label, message: `${fixes.join("; ")}: ${STANDARD}` })
  for (const member of members) visitMember(member, `${label}.${member.name}`, scan)
}

const visitMember = (member: Member, label: string, scan: Scan) => {
  if (member.params !== undefined && isPaged(member, scan.pagingTypes)) {
    const fixes = [
      ...(isArray(unwrapPromise(member.type)) ? ["returns a bare array"] : []),
      ...(PAGE_NUMBER.test(member.params) ? ["takes a page number; take `offset` and `limit`"] : []),
    ]
    if (fixes.length > 0) scan.found.push({ target: label, message: `${fixes.join("; ")}: ${STANDARD}` })
  }
  for (const body of objectsIn(member.type)) visitObject(body, label, scan)
}

const DECLARATION = /\b(interface|class|type|function|const|let|var)\s+([\w$]+)/g

const statementEnd = (text: string, from: number): number => {
  let depth = 0
  for (let at = from; at < text.length; at += 1) {
    depth += depthStep(text, at)
    if (depth < 0 || (depth === 0 && text[at] === ";")) return at
  }
  return text.length
}

/**
 * Findings in one declaration file; targets name the declaration, `AttachmentsService.list`. `pagingTypes` gains the
 * file's own types that declare a limit or an offset.
 */
export const shapeFindings = (text: string, pagingTypes = new Set<string>()): ShapeFinding[] => {
  const code = text.replace(STRINGS_AND_COMMENTS, (match) => (match.startsWith("/") ? " " : '""'))
  const scan: Scan = { found: [], pagingTypes }
  let done = 0
  for (const match of code.matchAll(DECLARATION)) {
    if (match.index < done) continue
    const [whole, keyword, name] = match as unknown as [string, string, string]
    const start = match.index + whole.length
    if (keyword === "interface" || keyword === "class") {
      const head = code.slice(start).match(/^\s*/)?.[0].length ?? 0
      const afterGenerics = code[start + head] === "<" ? closing(code, start + head) : start + head
      const open = code.indexOf("{", afterGenerics)
      if (open < 0) continue
      done = closing(code, open)
      const inherits = /\b(?:extends|implements)\b/.test(code.slice(afterGenerics, open))
      visitObject(code.slice(open + 1, done - 1), name, scan, inherits)
      continue
    }
    done = statementEnd(code, start)
    const rest = code.slice(start, done)
    if (keyword === "type") {
      const type = skipGenerics(rest.trimStart()).replace(/^=/, "").trim()
      const arrow = arrowOf(type)
      visitMember(arrow ? { name, params: arrow.params, type: arrow.returns } : { name, type }, name, scan)
    } else {
      const member = memberOf(`${name}${rest}`)
      if (member) visitMember(member, name, scan)
    }
  }
  return scan.found
}

/** Nothing built at all is a skip the lint reports, not a violation: a test run that did not build reads no types. */
export const resultShape = ({ files, missing }: Declarations): ShapeFinding[] => {
  if (files.length === 0) return []
  const pagingTypes = new Set<string>()
  for (const { text } of files) shapeFindings(text, pagingTypes)
  return [
    ...missing.map((path) => ({
      target: `${path}: not built`,
      message: "package.json declares these types, but the file does not exist: build them before cli-dev lint",
    })),
    ...files.flatMap(({ path, text }) =>
      shapeFindings(text, pagingTypes).map((finding) => ({ ...finding, target: `${path}: ${finding.target}` })),
    ),
  ]
}
