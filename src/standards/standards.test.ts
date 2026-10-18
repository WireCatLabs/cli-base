import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import * as v from "valibot"
import { describe, expect, it } from "vitest"
import {
  defineLogEvents,
  defineReasons,
  defineSteps,
  errorObjectSchema,
  isContentKey,
  itemEnvelopeSchema,
  jsonlEndSchema,
  jsonlItemSchema,
  jsonlOf,
  jsonSchemaOf,
  LOG_EVENTS,
  listEnvelopeSchema,
  logRecordSchema,
  RegistryError,
  STEPS,
  stepOf,
  traceIdOf,
} from "./index.js"
import {
  baselineProblems,
  baselineSchema,
  defineFieldRules,
  defineIdentifiers,
  defineLintRules,
  defineVocabulary,
  FIELD_RULES,
  IDENTIFIERS,
  LINT_RULES,
  overridesProblems,
  overridesSchema,
  rulesForReview,
  VOCABULARY,
  vocabularySchema,
} from "./tables.js"

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

  it("takes the value names commands already show: key=level, hh:mm and a repeatable ref...", () => {
    const flag = (value: string) => ({ name: "--x", value, type: "string", role: "value", meaning: "x" })
    for (const value of ["<key=level>", "<hh:mm>", "<ref...>"])
      expect(problemsOf(() => defineVocabulary(vocabulary({ flags: [flag(value)] })))).toEqual([])
    expect(problemsOf(() => defineVocabulary(vocabulary({ flags: [flag("<a.b>")] })))[0]).toMatch(/a value name/)
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

  it("refuses a flag synonym that is itself a flag, and lists --limit's", () => {
    expect(VOCABULARY.flags.find((flag) => flag.name === "--limit")?.replaces).toEqual([
      "--max",
      "--count",
      "--take",
      "--max-results",
      "--lines",
      "--limit-groups",
    ])
    expect(
      problemsOf(() =>
        defineVocabulary(
          vocabulary({
            flags: [
              {
                name: "--limit",
                value: "<n>",
                type: "count",
                role: "paging",
                meaning: "how many",
                replaces: ["--max"],
              },
              { name: "--max", value: "<n>", type: "count", role: "paging", meaning: "how many" },
            ],
          }),
        ),
      ),
    ).toEqual(["flags: --limit replaces --max, which is itself a flag"])
  })

  it("names a rule's action --do, one list for every kind of rule, and routes --occurred to --occurred-time", () => {
    const flag = (name: string) => VOCABULARY.flags.find((entry) => entry.name === name)
    expect(flag("--do")).toMatchObject({ value: "<actions>", type: "list" })
    expect(flag("--occurred-time")?.replaces).toEqual(["--occurred"])
    expect(flag("--source")?.replaces).toEqual(["--target-accounts"])
  })
})

describe("output registry", () => {
  const meta = { run_id: "r1", duration_ms: 12, complete: true }

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
    expect(
      v.is(list, { items: [{ ref: "chat:1" }], page: { mode: "page", limit: 20, has_more: true }, next: [next], meta }),
    ).toBe(true)
    expect(v.is(list, [{ ref: "chat:1" }])).toBe(false)
    expect(
      v.is(list, { items: [], page: { mode: "page", limit: 20, has_more: false }, next: [next, next, next], meta }),
    ).toBe(false)
    expect(
      v.is(itemEnvelopeSchema(v.string()), {
        item: "done",
        missing: [{ field: "text", why: "not read yet", step: "attachments.extract" }],
        meta,
      }),
    ).toBe(true)
  })

  it("accepts a missing entry with no step, and refuses an unknown key", () => {
    const item = itemEnvelopeSchema(v.string())
    expect(v.is(item, { item: "x", missing: [{ field: "text", why: "not read" }], meta })).toBe(true)
    expect(v.is(item, { item: "x", meta, hits: [] })).toBe(false)
  })

  it("types a page by how the source pages: numbers, or an opaque cursor, never both", () => {
    const list = listEnvelopeSchema(v.string())
    const of = (page: unknown) => v.is(list, { items: [], page, meta })
    expect(of({ mode: "page", limit: 20, has_more: true, next_page: 3 })).toBe(true)
    expect(of({ mode: "cursor", limit: 20, has_more: true, next_cursor: "eyJ0IjoxfQ" })).toBe(true)
    expect(of({ mode: "cursor", limit: 20, has_more: true, next_page: 2 })).toBe(false)
    expect(of({ limit: 20, has_more: false })).toBe(false)
  })

  it("says a partial answer is partial, with the sources it is missing, instead of skipped", () => {
    const list = listEnvelopeSchema(v.string())
    const page = { mode: "page", limit: 20, has_more: false }
    const partial = {
      ...meta,
      complete: false,
      issues: [{ code: "authentication_error", reason: "auth.failed", source: "work" }],
    }
    expect(v.is(list, { items: ["a"], page, meta: partial })).toBe(true)
    expect(v.is(list, { items: ["a"], page, meta: { run_id: "r1", duration_ms: 1 } })).toBe(false)
    expect(v.is(list, { items: [], page, meta: { ...meta, skipped: [{ account: "work", why: "x" }] } })).toBe(false)
    expect(v.is(list, { items: [], page, meta: { ...partial, issues: [{ code: "skipped", source: "work" }] } })).toBe(
      false,
    )
  })

  it("writes a list as JSON lines that end with a line saying whether it is whole", () => {
    const page = { mode: "cursor" as const, limit: 2, has_more: true, next_cursor: "c2" }
    const issues = [{ code: "timeout" as const, source: "personal" }]
    const lines = jsonlOf({ items: [{ ref: "a" }, { ref: "b" }], page, meta: { ...meta, complete: false, issues } })
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(lines).toEqual([
      { type: "item", data: { ref: "a" } },
      { type: "item", data: { ref: "b" } },
      { type: "end", complete: false, issues, page },
    ])
    expect(v.is(jsonlItemSchema(v.object({ ref: v.string() })), lines[0])).toBe(true)
    expect(v.is(jsonlEndSchema, lines[2])).toBe(true)
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

  it("refuses a baseline that lists a target twice, and an override with no reason, owner or review date", () => {
    expect(baselineProblems(["chats list", "chats list"])).toEqual(['"chats list" is listed twice'])
    const kept = { rule: "unknown-verb", target: "bot api", reason: "mirrors the official Bot API" }
    const owned = { ...kept, owner: "@leemour", review_after: "2027-01-01" }
    expect(v.is(overridesSchema, [{ ...owned, reason: "" }])).toBe(false)
    expect(v.is(overridesSchema, [kept])).toBe(false)
    expect(v.is(overridesSchema, [{ ...owned, review_after: "soon" }])).toBe(false)
    expect(v.is(overridesSchema, [{ ...owned, owner: "leemour" }])).toBe(false)
    expect(v.is(overridesSchema, [owned, { ...owned, owner: "@WireCatLabs/cli" }])).toBe(true)
    expect(overridesProblems([owned], "2027-01-01")).toEqual([])
    expect(overridesProblems([owned], "2027-01-02")).toEqual([
      '"unknown-verb bot api" was due for review on 2027-01-01; ask @leemour',
    ])
  })

  it("flags a rule overridden more than three times across the CLIs for review", () => {
    const one = (rule: string, target: string) => ({
      rule,
      target,
      reason: "kept on purpose",
      owner: "@a",
      review_after: "2027-01-01",
    })
    expect(
      rulesForReview([
        [one("unknown-verb", "a"), one("unknown-verb", "b"), one("option-role", "x")],
        [one("unknown-verb", "c"), one("unknown-verb", "d")],
      ]),
    ).toEqual([{ rule: "unknown-verb", overrides: 4 }])
    expect(rulesForReview([[one("unknown-verb", "a"), one("unknown-verb", "b"), one("unknown-verb", "c")]])).toEqual([])
  })

  it("keeps one name per identifier, and refuses a replaced name that is itself a key", () => {
    expect(IDENTIFIERS.map((entry) => entry.key)).toEqual(["run_id", "operation_id", "request_id", "trace_id"])
    expect(
      problemsOf(() =>
        defineIdentifiers([
          { key: "run_id", meaning: "one run", replaces: ["trace_id"] },
          { key: "trace_id", meaning: "a trace" },
        ]),
      ),
    ).toEqual(['"trace_id" is listed twice', '"trace_id" is both a key and replaced'])
  })
})

describe("log events registry", () => {
  it("registers dotted event ids with their keys, once each", () => {
    expect(LOG_EVENTS.map((event) => event.id)).toContain("command.failed")
    expect(
      problemsOf(() =>
        defineLogEvents([
          { id: "sync.done", meaning: "a sync ended", keys: ["count", "count"] },
          { id: "sync.done", meaning: "again", keys: [] },
        ]),
      ),
    ).toEqual(['"sync.done" is listed twice', 'sync.done: key "count" is listed twice'])
    expect(problemsOf(() => defineLogEvents([{ id: "request", meaning: "a request", keys: [] }]))[0]).toMatch(/^0\.id:/)
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

describe("the runtime entry", () => {
  const reached = (file: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(file)) return seen
    seen.add(file)
    for (const [, path] of readFileSync(file, "utf8").matchAll(/from "(\.{1,2}\/[^"]+)\.js"/g))
      reached(join(dirname(file), `${path}.ts`), seen)
    return seen
  }

  it("**never loads the dev tables**: a command start does not parse vocabulary, lint, audit or field rules", () => {
    const files = [...reached(join(import.meta.dirname, "index.ts"))].map((file) =>
      file.slice(file.lastIndexOf("/") + 1),
    )
    for (const table of [
      "vocabulary.ts",
      "flags-how.ts",
      "flags-what.ts",
      "lint.ts",
      "audit.ts",
      "identifiers.ts",
      "fields.ts",
    ])
      expect(files).not.toContain(table)
  })
})
