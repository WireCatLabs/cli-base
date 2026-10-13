import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CliError } from "../errors.js"
import { parseLucene } from "./parser.js"
import { QUERY_LIMITS } from "./types.js"

interface Reference {
  query: string
  parsed: boolean
}
const corpus: Reference[] = JSON.parse(readFileSync(new URL("./reference.json", import.meta.url), "utf8"))
const reason = (run: () => unknown) => {
  try {
    run()
    return undefined
  } catch (error) {
    return error instanceof CliError ? error.details?.reason : "unexpected"
  }
}

describe("Lucene 9.12.3 grammar port", () => {
  for (const row of corpus)
    it(`matches upstream syntax acceptance: ${JSON.stringify(row.query)}`, () => {
      if (!row.parsed) expect(reason(() => parseLucene(row.query))).toBeDefined()
      else if (/[~^@]/u.test(row.query) || row.query.startsWith("fn:"))
        expect(reason(() => parseLucene(row.query))).toBe("query.unsupported-operator")
      else expect(parseLucene(row.query)).toMatchObject({ version: 1, language: "lucene-v1" })
    })
  it("preserves clause occurrences and adjacency", () => {
    expect(parseLucene("alpha OR beta gamma").root).toMatchObject({
      kind: "boolean",
      clauses: [
        { occur: "must", node: { kind: "boolean", clauses: [{ occur: "should" }, { occur: "should" }] } },
        { occur: "must" },
      ],
    })
    expect(parseLucene("+alpha OR beta").root).toMatchObject({
      kind: "boolean",
      clauses: [{ occur: "must" }, { occur: "should" }],
    })
    expect(parseLucene("NOT alpha").root).toMatchObject({ kind: "boolean", clauses: [{ occur: "mustNot" }] })
  })
  it("decodes standard escaped punctuation and Unicode without turning escaped stars into wildcards", () => {
    expect(parseLucene("text:hello\\:world").root).toMatchObject({ value: "hello:world", operator: "term" })
    expect(parseLucene("text:\\u03b1").root).toMatchObject({ value: "α" })
    expect(parseLucene("text:a\\*").root).toMatchObject({ value: "a*", operator: "term" })
    expect(reason(() => parseLucene("foo\\u0xyz"))).toBe("query.invalid-escape")
  })
  it("rejects excessive text, nodes, groups and malformed syntax with spans", () => {
    expect(reason(() => parseLucene("x".repeat(QUERY_LIMITS.bytes + 1)))).toBe("query.too-large")
    expect(reason(() => parseLucene("a ".repeat(300)))).toBe("query.too-large")
    expect(reason(() => parseLucene(`${"(".repeat(33)}alpha${")".repeat(33)}`))).toBe("query.too-large")
    expect(reason(() => parseLucene('"unterminated'))).toBe("query.unclosed-literal")
    expect(reason(() => parseLucene("alpha [TO wrong TO]"))).toBe("query.invalid-syntax")
  })
  it.each([">", ">=", "<", "<="])("reads the Elasticsearch spelling date:%s as the colon-less comparison", (op) => {
    const { span, ...colon } = parseLucene(`date:${op}2026-10-10`).root
    const { span: plainSpan, ...plain } = parseLucene(`date${op}2026-10-10`).root
    expect(colon).toEqual(plain)
    expect(span).toEqual({ start: 0, end: plainSpan.end + 1 })
  })
})

describe("a list's query", () => {
  const failure = (run: () => unknown): CliError => {
    try {
      run()
    } catch (error) {
      if (error instanceof CliError) return error
    }
    throw new Error("expected a CliError")
  }

  it("refuses a bare word, naming it and the command", () => {
    const error = failure(() => parseLucene("state:open book", { defaultField: "none", command: "tasks list" }))
    expect(error.message).toBe('tasks list: query.bare-word at position 12 — "book" has no field; write field:value')
    expect(error.details).toMatchObject({ reason: "query.bare-word", word: "book", span: { start: 11, end: 15 } })
  })

  it("names the command and the guide in every error", () => {
    const error = failure(() => parseLucene('"open', { command: "chats list", guide: "https://example.com/q" }))
    expect(error.message).toMatch(/^chats list: query\.unclosed-literal at position 1/)
    expect(error.details.guide).toBe("https://example.com/q")
    expect(failure(() => parseLucene('"open')).message).toMatch(/^query: /)
  })

  it("reads the terms lists need: quoted values with a colon, comparisons, presence, relative dates", () => {
    expect(failure(() => parseLucene("subject:note:42", { defaultField: "none" })).details.reason).toBe(
      "query.invalid-syntax",
    )
    for (const text of ['subject:"note:42"', "unread_count>0", "title:*work*", "local_path:* -text:*", 'date<"2h ago"'])
      expect(parseLucene(text, { defaultField: "none" })).toMatchObject({ version: 1 })
  })
})
