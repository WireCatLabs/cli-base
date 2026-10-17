import { describe, expect, it } from "vitest"
import { fieldsOf, projectFields } from "./result-fields.js"

describe("portable result projection", () => {
  it("projects nested arrays without dropping coverage, continuation or empty positions", () => {
    const coverage = { has_more: true, truncated_by: "bytes" }
    const input = {
      item: {
        source: "meeting:1/2/3/0",
        coverage,
        groups: [{ cues: [{ ref: "cue", text: "Example", hash: "large" }, { text: "No reference" }] }],
        next: [{ cursor: "next" }],
      },
      meta: { complete: false },
      missing: [{ field: "groups" }],
    }
    expect(projectFields(input, ["groups.cues.ref"])).toEqual({
      ...input,
      item: { coverage, groups: [{ cues: [{ ref: "cue" }, {}] }], next: input.item.next },
    })
    expect(input.item.groups[0]?.cues[0]?.hash).toBe("large")
    expect(projectFields({ rows: [] }, ["rows.ref"])).toEqual({ rows: [] })
    expect(projectFields({ rows: null }, ["rows.ref"])).toEqual({})
    expect(projectFields({ speaker: { name: "Example" } }, ["speaker.unknown"])).toEqual({})
  })
  it("keeps item report boundaries while using the same list shorthand", () => {
    const input = {
      item: { items: [{ ref: "cue", source: { title: "Example", url: null }, hash: "large" }], coverage: {} },
      meta: { complete: true },
      next: [],
    }
    expect(projectFields(input, ["items.ref", "source.title", "source.url"])).toEqual({
      ...input,
      item: { ...input.item, items: [{ ref: "cue", source: { title: "Example", url: null } }] },
    })
    const source = Object.freeze({ title: "Example", url: null })
    expect(projectFields({ sources: [source] }, ["sources.title", "sources"])).toEqual({ sources: [source] })
  })
  it("reads item. as the one answered thing, as items. is each listed one", () => {
    const input = { item: { profile: "personal", linked: true, device: { id: 7, name: "Chrome" } }, meta: {} }
    expect(projectFields(input, fieldsOf("item.profile,item.device.id"))).toEqual({
      item: { profile: "personal", device: { id: 7 } },
      meta: {},
    })
    expect(projectFields(input, ["profile"])).toEqual({ item: { profile: "personal" }, meta: {} })
  })
  it("projects unsealed item bodies before execution metadata is added", () => {
    const body = { item: { rows: [{ ref: "cue", text: "Example", hash: "large" }] }, next: [{ cursor: "next" }] }
    expect(projectFields(body, ["rows.ref", "rows.text"])).toEqual({
      ...body,
      item: { rows: [{ ref: "cue", text: "Example" }] },
    })
    expect(projectFields({ item: { id: 1 }, title: "Payload" }, ["title"])).toEqual({ title: "Payload" })
  })
  it("keeps page and operation metadata while selecting nested item data", () => {
    const input = {
      items: [{ id: 1, speaker: { id: 2, name: "Alice Example" }, text: "Example" }],
      page: 2,
      limit: 1,
      has_more: true,
      nextCursor: "example",
      operation_id: "example-operation",
    }
    expect(projectFields(input, fieldsOf("items.id,speaker.id"))).toEqual({
      ...input,
      items: [{ id: 1, speaker: { id: 2 } }],
    })
    expect(input.items[0]?.speaker.name).toBe("Alice Example")
    expect(projectFields(input.items, ["id"])).toEqual([{ id: 1 }])
    expect(projectFields(input.items[0], ["items.id"])).toEqual({ id: 1 })
  })
  it("keeps operation identifiers, null values and parent selections", () => {
    expect(projectFields({ id: 1, operation_id: "example", missing: null }, ["missing", "unknown"])).toEqual({
      missing: null,
      operation_id: "example",
    })
    const speaker = { id: 1, name: "Alice Example" }
    expect(projectFields({ speaker }, ["speaker.id", "speaker"])).toEqual({ speaker })
    expect(projectFields({ speaker: null }, ["speaker.id"])).toEqual({})
    expect(projectFields(null, ["id"])).toBeNull()
    expect(projectFields(3, ["id"])).toBe(3)
    expect(projectFields(Object.create({ id: 3 }), ["id"])).toEqual({})
    expect(projectFields(Object.assign(Object.create({ type: "item" }), { data: { id: 1 }, id: 2 }), ["id"])).toEqual({
      id: 2,
    })
    expect(projectFields({ items: null, id: 1 }, ["id"])).toEqual({ id: 1 })
  })
  it("rejects unsafe, empty or excessive paths even when supplied directly", () => {
    for (const path of ["", "a..b", "items.__proto__.x", "constructor", "a.prototype.x", "id,", "a".repeat(257)]) {
      expect(() => fieldsOf(path)).toThrow(/field paths/)
      expect(() => projectFields({}, [path])).toThrow(/field paths/)
    }
    expect(() => fieldsOf(Array(129).fill("id").join(","))).toThrow(/field paths/)
    expect(() => projectFields({}, [])).toThrow(/field paths/)
    expect(fieldsOf("id, id,speaker.id")).toEqual(["id", "speaker.id"])
    expect({}).not.toHaveProperty("polluted")
  })
})
