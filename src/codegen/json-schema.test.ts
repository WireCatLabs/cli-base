import { describe, expect, it } from "vitest"
import { requestSchema, type SchemaNode } from "./index.js"

const definitions: Record<string, SchemaNode> = {
  Event: {
    type: "object",
    description: "A calendar event.",
    properties: {
      summary: { type: "string", maxLength: 1024 },
      attendees: { type: "array", items: { type: "ref", ref: "Attendee" }, maxItems: 100 },
      status: { type: "string", enum: ["confirmed", "cancelled"] },
    },
    required: ["summary"],
  },
  Attendee: {
    type: "object",
    properties: { email: { type: "string" }, event: { type: "ref", ref: "Event" } },
    required: [],
    additionalProperties: { type: "unknown" },
  },
}

describe("requestSchema", () => {
  it("is null for an operation that takes no body", () => {
    expect(requestSchema({}, definitions)).toBeNull()
    expect(requestSchema({ request: { required: false, confidence: "contract" } }, definitions)).toBeNull()
  })

  it("puts every definition the body reaches under $defs once, cycles included", () => {
    const schema = requestSchema({ request: { required: true, confidence: "contract", schema: "Event" } }, definitions)
    expect(schema).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $ref: "#/$defs/Event",
      $defs: {
        Event: {
          description: "A calendar event.",
          type: "object",
          properties: {
            summary: { type: "string", maxLength: 1024 },
            attendees: { type: "array", items: { $ref: "#/$defs/Attendee" }, maxItems: 100 },
            status: { type: "string", enum: ["confirmed", "cancelled"] },
          },
          required: ["summary"],
          additionalProperties: true,
        },
        Attendee: {
          type: "object",
          properties: { email: { type: "string" }, event: { $ref: "#/$defs/Event" } },
          required: [],
          additionalProperties: {},
        },
      },
    })
  })

  it("stops on a reference the definitions do not hold", () => {
    expect(() =>
      requestSchema({ request: { required: true, confidence: "contract", schema: "Missing" } }, definitions),
    ).toThrow("generated schema reference is missing: Missing")
  })
})
