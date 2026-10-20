// Port of Lucene 9.12.3 StandardSyntaxParser.jj and BooleanModifiersQueryNodeProcessor (Apache-2.0).
// Notices: THIRD_PARTY_NOTICES; upstream sources and the reference generator: cli-messaging scripts/search-reference.
// Adjacency is Query(DisjQuery*), not ConjQuery.
import {
  type Predicate,
  QUERY_LIMITS,
  type QueryAst,
  type QueryContext,
  type QueryNode,
  queryError,
  type Span,
  walkQuery,
} from "./types.js"

interface Token {
  kind: string
  raw: string
  span: Span
}
const whitespace = (c: string) => /[ \t\n\r\u3000]/u.test(c)
const reserved = new Set([
  "+",
  "-",
  "!",
  "(",
  ")",
  ":",
  "=",
  "^",
  "@",
  "<",
  ">",
  "[",
  "]",
  '"',
  "{",
  "}",
  "~",
  "\\",
  "/",
])
type Fail = (reason: string, span: Span, alternative?: string) => never
const decodeEscapes = (raw: string, span: Span, fail: Fail): string => {
  let out = ""
  for (let at = 0; at < raw.length; at++) {
    if (raw[at] !== "\\") {
      out += raw[at]
      continue
    }
    if (++at >= raw.length) fail("query.invalid-escape", span)
    if (raw[at] === "u") {
      const hex = raw.slice(at + 1, at + 5)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("query.invalid-escape", span)
      out += String.fromCharCode(Number.parseInt(hex, 16))
      at += 4
    } else out += raw[at]
  }
  return out
}
const tokensOf = (text: string, fail: Fail = queryError): Token[] => {
  const tokens: Token[] = []
  let at = 0
  let range = false
  while (at < text.length) {
    const start = at
    const c = text[at] ?? ""
    if (whitespace(c)) {
      at++
      continue
    }
    let kind = c
    if (c === '"' || (!range && c === "/")) {
      at++
      while (at < text.length && text[at] !== c) {
        if (text[at] === "\\" && (c === '"' || text[at + 1] === "/")) at++
        at++
      }
      if (at >= text.length)
        fail("query.unclosed-literal", { start, end: at }, c === "/" ? regexHint(text, start) : undefined)
      at++
      if (c === "/" && /^[dgimsuvy]+(?:$|[ \t\n\r)])/.test(text.slice(at)))
        fail("query.unsupported-regex-flags", { start: at, end: at + 1 }, "Lucene regex does not take JavaScript flags")
      kind = c === '"' ? "quoted" : "regex"
    } else if (range && c !== "]" && c !== "}") {
      while (at < text.length && !whitespace(text[at] ?? "") && !["]", "}"].includes(text[at] ?? "")) at++
      kind = "rangeValue"
    } else if (reserved.has(c)) {
      if (c === "\\") {
        at += 2
        while (
          at < text.length &&
          !whitespace(text[at] ?? "") &&
          (!reserved.has(text[at] ?? "") || ["+", "-"].includes(text[at] ?? ""))
        )
          at++
        kind = "term"
      } else {
        at++
        if ((c === "<" || c === ">") && text[at] === "=") {
          at++
          kind += "="
        }
        if (c === "[" || c === "{") range = true
        if (c === "]" || c === "}") range = false
      }
    } else {
      at++
      while (at < text.length) {
        const next = text[at] ?? ""
        if (next === "\\") {
          if (at + 1 >= text.length) fail("query.invalid-escape", { start: at, end: at + 1 })
          at += 2
          continue
        }
        if (next === "@" && /^@(?:\p{L}|[\p{L}\p{N}][^\s@]*\.[\p{L}\p{N}])/u.test(text.slice(at))) {
          at++
          continue
        }
        if (whitespace(next) || (reserved.has(next) && next !== "+" && next !== "-")) break
        at++
      }
      const raw = text.slice(start, at)
      kind =
        ({ AND: "AND", OR: "OR", NOT: "NOT", "&&": "AND", "||": "OR" } as Record<string, string>)[raw] ??
        (/^\d+(?:\.\d+)?$/u.test(raw) ? "number" : "term")
    }
    tokens.push({ kind, raw: text.slice(start, at), span: { start, end: at } })
  }
  tokens.push({ kind: "EOF", raw: "", span: { start: at, end: at } })
  return tokens
}
interface Clause {
  node: QueryNode
  modifier?: "must" | "must_not"
}
export interface ParseOptions extends QueryContext {
  /** The field a bare word searches; `none` for a list, where a bare word is `query.bare-word`. */
  defaultField?: string
}

// A value written without quotes that holds an operator (`url:a.com/x?y=1`) fails at a character the reader does not
// see as special; name the fix instead.
const quoteHint = (text: string, at: number): string | undefined => {
  for (const match of text.matchAll(/(?<=^|[\s(])([\p{L}\p{N}_.-]+):([^\s"()]+)/gu)) {
    const [whole, field, value = ""] = match
    if (at < match.index || at > match.index + whole.length) continue
    return /[:=/?*~^@<>![\]{}\\]/u.test(value) ? `put the value in quotes: ${field}:"${value}"` : undefined
  }
  return undefined
}

// An unquoted `text/plain` opens a regular expression that never closes, so the error names the slash, not a quote.
const regexHint = (text: string, at: number): string => {
  const word = `${/[^\s()"]*$/u.exec(text.slice(0, at))?.[0] ?? ""}${/^[^\s()"]*/u.exec(text.slice(at))?.[0] ?? ""}`
  return quoteHint(text, at) ?? `/ starts a regular expression; put the value in quotes: "${word}"`
}

export const parseLucene = (text: string, { defaultField = "text", ...context }: ParseOptions = {}): QueryAst => {
  const fail: Fail = (reason, span, alternative) =>
    queryError(reason, span, alternative ?? quoteHint(text, span.start), context)
  if (text.length > QUERY_LIMITS.bytes || new TextEncoder().encode(text).length > QUERY_LIMITS.bytes)
    fail("query.too-large", { start: 0, end: text.length })
  const tokens = tokensOf(text, fail)
  let at = 0
  let count = 0
  let depth = 0
  const peek = () => tokens[at] as Token
  const take = () => tokens[at++] as Token
  const expect = (kind: string) => {
    if (peek().kind !== kind) fail("query.invalid-syntax", peek().span)
    return take()
  }
  const built = <T extends QueryNode>(node: T): T => {
    if (++count > QUERY_LIMITS.nodes) fail("query.too-large", node.span)
    return node
  }
  const combine = (clauses: Clause[], occur: "must" | "should"): Clause => {
    const first = clauses[0]
    const last = clauses.at(-1)
    if (!first || !last) fail("query.invalid-syntax", peek().span)
    if (clauses.length === 1) return first
    return {
      node: built({
        kind: "boolean",
        clauses: clauses.map(({ node, modifier }) => ({ node, occur: modifier ?? occur })),
        span: { start: first.node.span.start, end: last.node.span.end },
      }),
    }
  }
  const query = (field: string, implicit = false): QueryNode => {
    if (++depth > QUERY_LIMITS.depth) fail("query.too-large", peek().span)
    const clauses: Clause[] = []
    do {
      clauses.push(disjunction(field, implicit))
    } while (!["EOF", ")"].includes(peek().kind))
    const result = combine(clauses, "must")
    depth--
    if (result.modifier === "must_not")
      return built({ kind: "boolean", clauses: [{ node: result.node, occur: "must_not" }], span: result.node.span })
    return result.node
  }
  const disjunction = (field: string, implicit: boolean): Clause => {
    const clauses = [conjunction(field, implicit)]
    while (peek().kind === "OR") {
      take()
      clauses.push(conjunction(field, implicit))
    }
    return combine(clauses, "should")
  }
  const conjunction = (field: string, implicit: boolean): Clause => {
    const clauses = [clause(field, implicit)]
    while (peek().kind === "AND") {
      take()
      clauses.push(clause(field, implicit))
    }
    return combine(clauses, "must")
  }
  const clause = (inherited: string, inheritedImplicit: boolean): Clause => {
    let modifier: Clause["modifier"]
    if (["+", "-", "NOT", "!"].includes(peek().kind)) modifier = take().kind === "+" ? "must" : "must_not"
    let field = inherited
    // An error about `field:value` points at the field, where the comparison form already starts.
    let start: number | undefined
    let implicit = inheritedImplicit
    if (peek().kind === "term" && [":", "=", "<", ">", "<=", ">="].includes(tokens[at + 1]?.kind ?? "")) {
      const token = take()
      field = decodeEscapes(token.raw, token.span, fail)
      start = token.span.start
      implicit = false
      let operator = take()
      if (operator.kind === ":" && ["<", ">", "<=", ">="].includes(peek().kind)) operator = take()
      if (["<", ">", "<=", ">="].includes(operator.kind)) {
        const value = take()
        if (!["term", "number", "quoted"].includes(value.kind)) fail("query.invalid-syntax", value.span)
        const decoded = decodeEscapes(value.kind === "quoted" ? value.raw.slice(1, -1) : value.raw, value.span, fail)
        const lower = operator.kind.startsWith(">")
        const node = built<Predicate>({
          kind: "predicate",
          field,
          operator: "range",
          value: lower ? decoded : "*",
          upper: lower ? "*" : decoded,
          lower_inclusive: !lower || operator.kind.endsWith("="),
          upper_inclusive: lower || operator.kind.endsWith("="),
          span: { start: token.span.start, end: value.span.end },
        })
        return { node, ...(modifier ? { modifier } : {}) }
      }
    }
    let node: QueryNode
    if (peek().kind === "(") {
      const start = take().span.start
      node = query(field, implicit)
      const end = expect(")").span.end
      node = { ...node, span: { start, end } }
    } else if (["[", "{"].includes(peek().kind)) {
      const opening = take()
      const lower = take()
      if (!["rangeValue", "quoted"].includes(lower.kind)) fail("query.invalid-syntax", lower.span)
      const separator = take()
      if (separator.raw !== "TO") fail("query.invalid-syntax", separator.span)
      const upper = take()
      if (!["rangeValue", "quoted"].includes(upper.kind)) fail("query.invalid-syntax", upper.span)
      const closing = take()
      if (!["]", "}"].includes(closing.kind)) fail("query.invalid-syntax", closing.span)
      const decode = (t: Token) => decodeEscapes(t.kind === "quoted" ? t.raw.slice(1, -1) : t.raw, t.span, fail)
      node = built({
        kind: "predicate",
        field,
        operator: "range",
        value: decode(lower),
        upper: decode(upper),
        lower_inclusive: opening.kind === "[",
        upper_inclusive: closing.kind === "]",
        span: { start: start ?? opening.span.start, end: closing.span.end },
      })
    } else {
      const token = take()
      if (!["term", "number", "quoted", "regex"].includes(token.kind)) fail("query.invalid-syntax", token.span)
      const raw = ["term", "number"].includes(token.kind) ? token.raw : token.raw.slice(1, -1)
      if (field === "fn") fail("query.unsupported-operator", token.span, "interval functions are not supported")
      const wildcard = ["term", "number"].includes(token.kind) && /(?<!\\)[*?]/u.test(raw)
      node = built({
        kind: "predicate",
        field,
        operator:
          token.kind === "regex" ? "regex" : token.kind === "quoted" ? "phrase" : wildcard ? "wildcard" : "term",
        value: token.kind === "regex" || wildcard ? raw : decodeEscapes(raw, token.span, fail),
        span: { start: start ?? token.span.start, end: token.span.end },
        ...(implicit ? { implicit: true as const } : {}),
      })
    }
    if (peek().kind === "~")
      fail(
        "query.unsupported-operator",
        peek().span,
        node.kind === "predicate" && node.operator === "phrase"
          ? "proximity (~) is not supported — drop the ~ for the exact phrase, or join the words with AND"
          : "fuzzy matching (~) is not supported — use a prefix such as word* to catch word forms",
      )
    if (["^", "@"].includes(peek().kind))
      fail("query.unsupported-operator", peek().span, "boost and minimum-should-match are not supported")
    return { node, ...(modifier ? { modifier } : {}) }
  }
  const root = query(defaultField, true)
  expect("EOF")
  if (defaultField === "none") {
    const bare = walkQuery(root).find((node) => node.implicit)
    if (bare)
      queryError("query.bare-word", bare.span, `"${bare.value}" has no field; write field:value`, context, {
        word: bare.value,
      })
  }
  return { version: 1, language: "lucene-v1", root }
}

/** Bare terms eligible for forgiving retrieval; explicit syntax keeps strict semantics. */
export const implicitTextTerms = (text: string): Set<number> => {
  const tokens = tokensOf(text)
  if (tokens.some(({ kind }) => ["AND", "OR", "NOT", "+", "-", "!", "(", ")"].includes(kind))) return new Set()
  return new Set(
    tokens.flatMap((token, index) =>
      token.kind === "term" &&
      ![":", "=", "<", ">", "<=", ">="].includes(tokens[index - 1]?.kind ?? "") &&
      ![":", "=", "<", ">", "<=", ">="].includes(tokens[index + 1]?.kind ?? "")
        ? [token.span.start]
        : [],
    ),
  )
}
