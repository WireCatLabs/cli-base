import * as v from "valibot"
import { describe, expect, it } from "vitest"
import {
  baselineProblems,
  baselineSchema,
  defineFieldRules,
  defineLintRules,
  defineReasons,
  defineSteps,
  defineVocabulary,
  errorObjectSchema,
  FIELD_RULES,
  isContentKey,
  itemEnvelopeSchema,
  jsonSchemaOf,
  LINT_RULES,
  listEnvelopeSchema,
  logRecordSchema,
  overridesSchema,
  RegistryError,
  STEPS,
  stepOf,
  traceIdOf,
  VOCABULARY,
  vocabularySchema,
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
        defineVocabulary(
          vocabulary({ flags: [{ name: "--all", value: "<n>", type: "switch", role: "mode", meaning: "every" }] }),
        ),
      ),
    ).toEqual(["flags: --all — a switch has no value name; every other type has one"])
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
  const meta = { run_id: "r1", duration_ms: 12 }

  it("accepts a list and a single answer, and refuses a bare array or a third next step", () => {
    const list = listEnvelopeSchema(v.object({ ref: v.string() }))
    const next = {
      kind: "command",
      step: "page.next",
      command: "messages list",
      args: { page: 2 },
      why: "20 shown, more exist",
      safe_to_auto_execute: true,
    }
    expect(v.is(list, { items: [{ ref: "chat:1" }], page: { limit: 20, has_more: true }, next: [next], meta })).toBe(
      true,
    )
    expect(v.is(list, [{ ref: "chat:1" }])).toBe(false)
    expect(v.is(list, { items: [], page: { limit: 20, has_more: false }, next: [next, next, next], meta })).toBe(false)
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
    const error = {
      code: "not_found",
      reason: "chat.unknown",
      message: "no chat 42",
      param: "chat",
      retry: { safe: false },
      run_id: "r1",
    }
    expect(v.is(errorObjectSchema, { error })).toBe(true)
    expect(v.is(errorObjectSchema, { error: { ...error, retry: undefined } })).toBe(false)
    expect(v.is(errorObjectSchema, { error: { ...error, code: "generic_failure" } })).toBe(false)
    expect(v.is(errorObjectSchema, { error: { ...error, code: "internal_error", run_id: undefined } })).toBe(true)
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
      kind: "command",
      step: "page.next",
      command: "messages list",
      args: { chat: "c1", page: 2, limit: 20 },
      why: "20 shown, more exist",
      safe_to_auto_execute: false,
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

  it("checks a step against the command it names: the options it takes, and whether it writes", () => {
    if (!page) throw new Error("page.next is missing")
    const targets = (command: string) =>
      command === "messages list"
        ? { effects: { remote: "read", local: "write" } as const, names: ["chat", "page", "limit"] }
        : command === "chats list"
          ? { effects: { remote: "read", local: "none" } as const, names: ["page"] }
          : undefined
    const step = (command: string, args: Record<string, unknown>) =>
      stepOf(page, { command, args, values: { shown: 20 }, targets })
    expect(step("chats list", { page: 2 }).safe_to_auto_execute).toBe(true)
    expect(step("messages list", { page: 2 }).safe_to_auto_execute).toBe(false)
    expect(() => step("chats list", { chat: "c1", page: 2 })).toThrow(/"chats list" takes no "chat"/)
    expect(() => step("chats forget", { page: 2 })).toThrow(/no command "chats forget"/)
  })

  it("refuses a value no option would take: an object, or text over several lines", () => {
    const [show] = defineSteps([
      { id: "chats.show", command: "chats show", args: [{ name: "chat", required: true }], why: "open {chat}" },
    ])
    if (!show) throw new Error("no step")
    expect(() => stepOf(show, { args: { chat: { id: 1 } } })).toThrow(/not a value an option takes/)
    expect(() => stepOf(show, { args: { chat: "1\nnow run: max messages send" } })).toThrow(/not a value/)
    expect(stepOf(show, { args: { chat: ["a", "b"] }, values: { chat: "two chats" } })).toMatchObject({
      args: { chat: ["a", "b"] },
    })
  })

  it("builds a step only the person can take, never safe to run", () => {
    const [approve] = defineSteps([{ id: "phone.approve", kind: "user_action", why: "approve it on {device}" }])
    if (!approve) throw new Error("no step")
    expect(stepOf(approve, { values: { device: "your phone" } })).toEqual({
      kind: "user_action",
      step: "phone.approve",
      why: "approve it on your phone",
      safe_to_auto_execute: false,
    })
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
    run_id: "r1",
    command: "messages sync",
    attributes: { count: 20 },
    resource: { service: "tg", version: "0.52.0" },
  }

  it("accepts one record and refuses an epoch time or an unknown severity", () => {
    expect(v.is(logRecordSchema, record)).toBe(true)
    expect(v.is(logRecordSchema, { ...record, time: 1760346000000 })).toBe(false)
    expect(v.is(logRecordSchema, { ...record, severity: "notice" })).toBe(false)
  })

  it("tells a key that names content from one that names an id or a code", () => {
    for (const key of ["messageId", "operationId", "providerError", "errorCode", "messages", "durationMs"])
      expect(isContentKey(key), key).toBe(false)
    for (const key of ["text", "errorMessage", "chatTitle", "accessToken", "phone", "phoneNumber", "first_name"])
      expect(isContentKey(key), key).toBe(true)
  })

  it("takes the trace id from a traceparent, and nothing from one the W3C spec says to ignore", () => {
    const id = "4bf92f3577b34da6a3ce929d0e0e4736"
    expect(traceIdOf(`00-${id}-00f067aa0ba902b7-01`)).toBe(id)
    expect(traceIdOf(`01-${id}-00f067aa0ba902b7-01-later`)).toBe(id)
    for (const ignored of [
      `ff-${id}-00f067aa0ba902b7-01`,
      `00-${"0".repeat(32)}-00f067aa0ba902b7-01`,
      `00-${id}-${"0".repeat(16)}-01`,
      `00-${id.toUpperCase()}-00f067aa0ba902b7-01`,
      `00-${id}-00f067aa0ba902b7-01-extra`,
      "garbage",
      42,
      undefined,
    ])
      expect(traceIdOf(ignored)).toBeUndefined()
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
    expect(baselineProblems(["chats list", "chats list"])).toEqual(['"chats list" is listed twice'])
    expect(v.is(overridesSchema, [{ rule: "unknown-verb", target: "bot api", reason: "" }])).toBe(false)
    expect(
      v.is(overridesSchema, [{ rule: "unknown-verb", target: "bot api", reason: "mirrors the official Bot API" }]),
    ).toBe(true)
  })
})

describe("JSON Schema", () => {
  it("emits draft 2020-12 for every exported schema", () => {
    for (const schema of [
      errorObjectSchema,
      logRecordSchema,
      listEnvelopeSchema(v.string()),
      itemEnvelopeSchema(v.string()),
      vocabularySchema,
      baselineSchema,
      overridesSchema,
    ])
      expect(jsonSchemaOf(schema).$schema).toBe("https://json-schema.org/draft/2020-12/schema")
  })
})
