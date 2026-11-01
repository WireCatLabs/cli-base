import * as v from "valibot"
import { describe, expect, it } from "vitest"
import { CliError } from "../errors.js"
import { isoTime, reference } from "../standards/output.js"
import { evaluate } from "./evaluate.js"
import { type FieldSpec, type QueryRegistry, queryFieldsOf } from "./fields.js"
import { fieldsHelp, queryDescription } from "./help.js"
import { parseLucene } from "./parser.js"
import { defineQuery, describeQuery, exampleProblems, QUERY_REASONS } from "./registry.js"
import { queryAstSchema } from "./types.js"
import { validateQuery } from "./validate.js"

const task = v.strictObject({
  ref: reference,
  id: v.string(),
  title: v.string(),
  state: v.picklist(["open", "done"]),
  priority: v.optional(v.pipe(v.number(), v.integer())),
  created_at: isoTime,
  closed_at: v.nullable(isoTime),
  urgent: v.boolean(),
  labels: v.array(v.string()),
  owner: v.strictObject({ id: v.string() }),
  provider_metadata: v.optional(v.record(v.string(), v.unknown())),
})

const fields = queryFieldsOf(task, {
  exclude: ["id"],
  text: ["title"],
  relations: {
    about: { type: "ref", example: 'about:"person:ana"', relation: "the notes it mentions", placement: "and" },
  },
  states: { ready: "open with nothing blocking it" },
  examples: { title: "title:invoice*" },
})
const registry: QueryRegistry = { entity: "task", backend: "sql", fields, defaults: ["state:open"] }

const parse = (text: string, on: QueryRegistry = registry) =>
  validateQuery(parseLucene(text, { defaultField: "none", command: "tasks list" }), on, { command: "tasks list" })

const reasonOf = (run: () => unknown) => {
  try {
    run()
    return undefined
  } catch (error) {
    return error instanceof CliError ? error.details.reason : "unexpected"
  }
}

describe("queryFieldsOf", () => {
  it("types every scalar key, skips objects, records and exclusions, and adds relations and states", () => {
    expect(fields.map(({ name, type, values }) => [name, type, values])).toEqual([
      ["ref", "ref", undefined],
      ["title", "txt", undefined],
      ["state", "enum", ["open", "done"]],
      ["priority", "num", undefined],
      ["created_at", "time", undefined],
      ["closed_at", "time", undefined],
      ["urgent", "bool", undefined],
      ["labels", "kw", undefined],
      ["about", "ref", undefined],
      ["is", "enum", ["ready"]],
    ])
    expect(fields.find((field) => field.name === "is")?.relation).toBe("ready: open with nothing blocking it")
    expect(exampleProblems(registry)).toEqual([])
  })
})

describe("the query tree as JSON", () => {
  it("is snake_case and matches its schema for a range, a negation and nested clauses", () => {
    const ast = parseLucene("size:[1 TO 20} AND -(alpha OR beta)")
    expect(v.parse(queryAstSchema, JSON.parse(JSON.stringify(ast)))).toEqual(ast)
    expect(JSON.stringify(ast)).toContain('"lower_inclusive":true,"upper_inclusive":false')
    expect(JSON.stringify(ast)).toContain('"occur":"must_not"')
    expect(v.safeParse(queryAstSchema, JSON.parse(JSON.stringify(ast).replace("must_not", "mustNot"))).success).toBe(
      false,
    )
  })
})

describe("validateQuery", () => {
  it.each([
    ["unread:1", "query.unknown-field"],
    ["state:closed", "query.unknown-value"],
    ["state:op*", "query.unsupported-operator"],
    ["closed_at:*", undefined],
    ["urgent:yes", "query.unknown-value"],
    ["priority>high", "query.invalid-number"],
    ["created_at>=someday", "query.invalid-date"],
    ["created_at:[2026-01-01 TO 2026-02-01}", undefined],
    ["state:[a TO b]", "query.unsupported-operator"],
    ['labels:""', "query.missing-value"],
    ['about:"person:ana" state:open', undefined],
    ['state:open OR about:"person:ana"', "query.unsupported-placement"],
    ['-about:"person:ana"', "query.unsupported-placement"],
  ])("%s → %s", (text, reason) => expect(reasonOf(() => parse(text))).toBe(reason))

  it("lists every field when one is unknown", () => {
    try {
      parse("unread:1")
    } catch (error) {
      expect((error as CliError).message).toBe('tasks list: query.unknown-field at position 1 — no field "unread"')
      expect((error as CliError).details.fields).toEqual(fields.map((field) => field.name))
    }
  })

  it("refuses on a native list a field the source cannot filter, naming the ones it can", () => {
    const native: QueryRegistry = {
      ...registry,
      backend: "native",
      fields: queryFieldsOf(task, { native: ["state", "created_at"] }),
    }
    expect(reasonOf(() => parse("state:open", native))).toBeUndefined()
    expect(defineQuery(native)).toBe(native)
    expect(fieldsHelp(native).split("\n").slice(1, 3)).toEqual([
      "  state       enum: open|done    state:open",
      "  created_at  time: term, range  created_at>=7d",
    ])
    try {
      parse("urgent:true", native)
      expect.unreachable()
    } catch (error) {
      expect((error as CliError).details).toMatchObject({
        reason: "query.unsupported-field",
        supported: ["state", "created_at"],
      })
    }
  })

  it("says which fields a native list can leave out, in its help and in one sentence for an MCP input", () => {
    const native: QueryRegistry = {
      ...registry,
      backend: "native",
      defaults: [],
      fields: queryFieldsOf(task, { native: ["state", "created_at"], negatable: ["state"] }),
    }
    expect(native.fields.find((field) => field.name === "state")?.negatable).toBe(true)
    expect(describeQuery(native).fields.find((field) => field.name === "state")).toMatchObject({ negatable: true })
    expect(fieldsHelp(native)).toContain("Leave out: -state:value or NOT state:value, for state")
    expect(queryDescription(native)).toBe(
      "field:value terms joined by AND that narrow the list; -field:value or NOT field:value leaves out what " +
        "matches, for state only; fields: state (open|done), created_at; e.g. state:open",
    )
    const plain = { ...native, fields: queryFieldsOf(task, { native: ["state"] }) }
    expect(fieldsHelp(plain)).not.toContain("Leave out")
    expect(queryDescription(plain)).toBe(
      "field:value terms joined by AND that narrow the list; fields: state (open|done); e.g. state:open",
    )
    expect(queryDescription({ ...native, fields: queryFieldsOf(task, {}) })).toMatch(/filters by none yet/)
  })

  it("runs a field's own check under the command's name", () => {
    const strict: QueryRegistry = {
      ...registry,
      fields: queryFieldsOf(task, {
        validate: {
          labels: (node) => {
            if (node.value.includes(" "))
              throw new CliError("validation_error", "x", { reason: "query.invalid-tag", span: node.span })
          },
        },
      }),
    }
    expect(reasonOf(() => parse('labels:"two words"', strict))).toBe("query.invalid-tag")
  })
})

describe("evaluate, the test oracle", () => {
  const item = {
    ref: "task:1",
    title: "Pay the invoice for March",
    state: "open",
    priority: 2,
    created_at: "2026-10-10T12:00:00Z",
    closed_at: null,
    urgent: true,
    labels: ["money", "home"],
  }
  const now = Date.parse("2026-10-13T12:00:00Z")
  const relation = (node: { field: string; value: string }) => node.field === "about" && node.value === "person:ana"

  it.each([
    ["state:open", true],
    ["state:done", false],
    ["-state:done", true],
    ["-state:open", false],
    ["title:invoice", true],
    ['title:"invoice for"', true],
    ['title:"for invoice"', false],
    ["title:inv*", true],
    ["labels:money", true],
    ["labels:work", false],
    ["labels:mo*", true],
    ["closed_at:*", false],
    ["created_at:*", true],
    ["priority>1", true],
    ["priority:[3 TO 5]", false],
    ["priority:{1 TO 2]", true],
    ["created_at:2026-10-10", true],
    ["created_at>=7d", true],
    ["created_at>=2d", false],
    ["urgent:true", true],
    ["state:done OR urgent:true", true],
    ["state:done OR urgent:false", false],
    ["+state:open OR labels:work", true],
    ["state:open labels:work", false],
    ['about:"person:ana"', true],
    ['about:"person:bo"', false],
  ])("%s → %s", (text, expected) => expect(evaluate(parse(text), fields, item, { now, relation })).toBe(expected))

  it("asks for a resolver before judging a relation", () => {
    expect(() => evaluate(parse('about:"person:ana"'), fields, item)).toThrow(/relation/)
  })
})

describe("defineQuery and help", () => {
  it("refuses a field twice, a camelCase name, and an example or default that does not run", () => {
    const bad: FieldSpec = { name: "unreadCount", type: "num", operators: ["term", "range"], example: "unreadCount>x" }
    expect(() =>
      defineQuery({ ...registry, fields: [...fields, fields[0] as FieldSpec, bad], defaults: ["state:gone"] }),
    ).toThrow(
      /"ref" is listed twice.*"unreadCount" is not snake_case.*unreadCount: .*invalid-number.*state: .*unknown-value/,
    )
  })

  it("checks one registry object once, and a changed copy again", () => {
    let reads = 0
    const counted = { ...(fields[2] as FieldSpec) }
    Object.defineProperty(counted, "example", {
      get: () => {
        reads++
        return "state:open"
      },
      enumerable: true,
    })
    const once: QueryRegistry = { ...registry, fields: [counted] }
    expect(defineQuery(once)).toBe(once)
    const afterFirst = reads
    expect(defineQuery(once)).toBe(once)
    expect(reads).toBe(afterFirst)
    expect(() => defineQuery({ ...once, defaults: ["state:gone"] })).toThrow(/unknown-value/)
  })

  it("describes the query for commands --json without hooks", () => {
    const described = describeQuery({ ...registry, fields: [{ ...(fields[2] as FieldSpec), validate: () => {} }] })
    expect(described).toEqual({
      entity: "task",
      backend: "sql",
      fields: [{ name: "state", type: "enum", operators: ["term"], values: ["open", "done"], example: "state:open" }],
      defaults: ["state:open"],
    })
  })

  it("prints the Fields section", () => {
    expect(fieldsHelp({ fields: fields.slice(1, 5), defaults: ["state:open"] }, "https://example.com/q")).toBe(
      [
        "Fields:",
        "  title       txt: term, phrase, wildcard  title:invoice*",
        "  state       enum: open|done              state:open",
        "  priority    num: term, range             priority>0",
        "  created_at  time: term, range            created_at>=7d",
        "Defaults: state:open — name the field to change it",
        'Syntax: field:value · "a phrase" · word* · AND OR NOT · ( ) · [a TO b] · > >= < <=',
        "Guide: https://example.com/q",
      ].join("\n"),
    )
  })

  it("registers a reason for every query error cli-base raises", () => {
    const reasons = QUERY_REASONS.map((entry) => entry.reason)
    for (const reason of ["query.bare-word", "query.unknown-field", "query.unsupported-field", "query.invalid-number"])
      expect(reasons).toContain(reason)
  })
})
