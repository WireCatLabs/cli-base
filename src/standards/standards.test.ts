import * as v from "valibot"
import { describe, expect, it } from "vitest"
import {
  baselineSchema,
  defineFieldRules,
  defineLintRules,
  defineReasons,
  defineSteps,
  defineVocabulary,
  errorObjectSchema,
  FIELD_RULES,
  itemEnvelopeSchema,
  jsonSchemaOf,
  LINT_RULES,
  listEnvelopeSchema,
  logRecordSchema,
  overridesSchema,
  RegistryError,
  STEPS,
  stepOf,
  VOCABULARY,
} from "./index.js"

const vocabulary = (patch: object) => ({
  verbs: [{ word: "list", meaning: "show many" }],
  nouns: [{ word: "chats", meaning: "conversations", kind: "collection" }],
  views: [],
  roots: [],
  flags: [],
  ...patch,
})

const problemsOf = (run: () => unknown): readonly string[] => {
  try {
    run()
  } catch (error) {
    if (error instanceof RegistryError) return error.problems
    throw error
  }
  return []
}

describe("vocabulary registry", () => {
  it("loads the seed, with the verbs, nouns and roots of STANDARD's command-name rules", () => {
    const verbs = VOCABULARY.verbs.map((entry) => entry.word)
    expect(verbs).toEqual(expect.arrayContaining(["list", "show", "sync", "fetch", "mark-read", "moderate"]))
    expect(VOCABULARY.nouns.find((entry) => entry.word === "store")?.kind).toBe("singular")
    expect(VOCABULARY.roots.map((entry) => entry.word)).toContain("search")
  })

  it("refuses a verb listed twice, a word with capitals, and a switch with a value name", () => {
    expect(
      problemsOf(() =>
        defineVocabulary(
          vocabulary({
            verbs: [
              { word: "list", meaning: "a" },
              { word: "list", meaning: "b" },
            ],
          }),
        ),
      ),
    ).toEqual(['verbs: "list" is listed twice'])
    expect(
      problemsOf(() => defineVocabulary(vocabulary({ verbs: [{ word: "List", meaning: "show many" }] })))[0],
    ).toMatch(/^verbs\.0\.word: a lower-case word/)
    expect(
      problemsOf(() =>
        defineVocabulary(vocabulary({ flags: [{ name: "--all", value: "<n>", type: "switch", meaning: "every" }] })),
      ),
    ).toEqual(["flags.0: a switch has no value name; every other type has one"])
  })

  it("refuses a verb that replaces another listed verb", () => {
    expect(
      problemsOf(() =>
        defineVocabulary(
          vocabulary({
            verbs: [
              { word: "list", meaning: "many", replaces: ["show"] },
              { word: "show", meaning: "one" },
            ],
          }),
        ),
      ),
    ).toEqual(['verbs: "list" replaces "show", which is itself a verb'])
  })
})

describe("output registry", () => {
  const meta = { runId: "r1", durationMs: 12 }

  it("accepts a list and a single answer, and refuses a bare array or a fourth next step", () => {
    const list = listEnvelopeSchema(v.object({ ref: v.string() }))
    const next = { step: "page.next", command: "messages list", args: { page: 2 }, why: "20 shown, more exist" }
    expect(v.is(list, { items: [{ ref: "chat:1" }], page: { limit: 20, hasMore: true }, next: [next], meta })).toBe(
      true,
    )
    expect(v.is(list, [{ ref: "chat:1" }])).toBe(false)
    expect(v.is(list, { items: [], page: { limit: 20, hasMore: false }, next: [next, next, next, next], meta })).toBe(
      false,
    )
    expect(
      v.is(itemEnvelopeSchema(v.string()), {
        item: "done",
        missing: [{ field: "text", why: "not read yet", step: "attachments.extract" }],
        meta,
      }),
    ).toBe(true)
  })

  it("refuses a missing entry with no step, and an unknown key", () => {
    const item = itemEnvelopeSchema(v.string())
    expect(v.is(item, { item: "x", missing: [{ field: "text", why: "not read" }], meta })).toBe(false)
    expect(v.is(item, { item: "x", meta, hits: [] })).toBe(false)
  })

  it("keeps field rules unique", () => {
    expect(FIELD_RULES.length).toBeGreaterThan(0)
    expect(
      problemsOf(() =>
        defineFieldRules([
          { id: "time", rule: "a" },
          { id: "time", rule: "b" },
        ]),
      ),
    ).toEqual(['"time" is listed twice'])
  })
})

describe("errors registry", () => {
  it("accepts the one error object and refuses a code off the closed list", () => {
    const error = { code: "not_found", reason: "chat.unknown", message: "no chat 42", param: "chat", runId: "r1" }
    expect(v.is(errorObjectSchema, { error })).toBe(true)
    expect(v.is(errorObjectSchema, { error: { ...error, code: "generic_failure" } })).toBe(false)
  })

  it("refuses a reason whose message names a detail it does not declare", () => {
    expect(
      problemsOf(() =>
        defineReasons([
          {
            reason: "store.locked",
            code: "configuration_error",
            message: "{path} is locked by {pid}",
            details: ["path"],
          },
        ]),
      ),
    ).toEqual(["store.locked: the message names {pid}, which is not one of its details"])
    expect(
      problemsOf(() => defineReasons([{ reason: "Locked", code: "timeout", message: "locked", details: [] }]))[0],
    ).toMatch(/^0\.reason:/)
  })
})

describe("steps registry", () => {
  const page = STEPS.find((step) => step.id === "page.next")

  it("builds a next entry that reruns the answer's command with its own arguments", () => {
    if (!page) throw new Error("page.next is missing")
    expect(
      stepOf(page, { command: "messages list", args: { chat: "c1", page: 2, limit: 20 }, values: { shown: 20 } }),
    ).toEqual({
      step: "page.next",
      command: "messages list",
      args: { chat: "c1", page: 2, limit: 20 },
      why: "20 shown, more exist",
    })
    expect(() => stepOf(page, { args: {} })).toThrow(/pass the command/)
    expect(() => stepOf(page, { command: "messages list", args: {} })).toThrow(/no value for \{shown\}/)
  })

  it("refuses an unknown or missing argument of a step with its own command", () => {
    const [sync] = defineSteps([
      {
        id: "messages.sync",
        command: "messages sync",
        args: [{ name: "chat", required: true }],
        why: "{chat} is behind",
      },
    ])
    if (!sync) throw new Error("no step")
    expect(stepOf(sync, { args: { chat: "c1" } }).why).toBe("c1 is behind")
    expect(() => stepOf(sync, { args: {} })).toThrow(/"chat" is required/)
    expect(() => stepOf(sync, { args: { chat: "c1", all: true } })).toThrow(/no argument "all"/)
  })

  it("refuses a step id that is not dotted, and one listed twice", () => {
    const step = { id: "page.next", command: "*", args: [], why: "more" }
    expect(problemsOf(() => defineSteps([step, step]))).toEqual(['"page.next" is listed twice'])
    expect(problemsOf(() => defineSteps([{ ...step, id: "next" }]))[0]).toMatch(/^0\.id: dotted/)
  })
})

describe("log registry", () => {
  const record = {
    time: "2026-10-13T09:00:00.000Z",
    severity: "info",
    body: "fetched 20 messages",
    runId: "r1",
    command: "messages sync",
    attributes: { count: 20 },
    resource: { service: "tg", version: "0.52.0" },
  }

  it("accepts one record and refuses an epoch time or an unknown severity", () => {
    expect(v.is(logRecordSchema, record)).toBe(true)
    expect(v.is(logRecordSchema, { ...record, time: 1760346000000 })).toBe(false)
    expect(v.is(logRecordSchema, { ...record, severity: "notice" })).toBe(false)
  })
})

describe("lint registry", () => {
  it("names every rule once, with a severity", () => {
    expect(LINT_RULES.map((rule) => rule.severity)).not.toContain(undefined)
    expect(
      problemsOf(() => defineLintRules([{ id: "x", severity: "urgent", scope: "command", summary: "s" }]))[0],
    ).toMatch(/^0\.severity:/)
  })

  it("refuses a baseline that lists a target twice and an override with no reason", () => {
    expect(v.is(baselineSchema, ["chats list", "chats list"])).toBe(false)
    expect(v.is(overridesSchema, [{ rule: "unknown-verb", target: "bot api", reason: "" }])).toBe(false)
    expect(
      v.is(overridesSchema, [{ rule: "unknown-verb", target: "bot api", reason: "mirrors the official Bot API" }]),
    ).toBe(true)
  })
})

describe("JSON Schema", () => {
  it("emits draft 2020-12 for every shape an answer, an error or a log line takes", () => {
    for (const schema of [
      errorObjectSchema,
      logRecordSchema,
      listEnvelopeSchema(v.string()),
      itemEnvelopeSchema(v.string()),
    ])
      expect(jsonSchemaOf(schema).$schema).toBe("https://json-schema.org/draft/2020-12/schema")
  })
})
