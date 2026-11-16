import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"
import { adaptOpenApi, generate, manifestGenerator, OpenApiError, typesGenerator, valibotGenerator } from "./index.js"

// facebook/openapi at e96a1c9dbf240c2937b6a95920685230458e346b (2026-08-11), MIT; the LICENSE is beside it. Its sample
// phone numbers are replaced with fictional 1555-01NN ones, as whatsapp-cli's snapshot is: no real number in a fixture.
const META = join(import.meta.dirname, "../../test/fixtures/openapi/business-messaging-api_v23.0.yaml")

const document = (
  schemas: Record<string, unknown>,
  paths: Record<string, unknown> = {},
  components: Record<string, unknown> = {},
) => ({
  openapi: "3.1.0",
  info: { version: "v1" },
  paths: {
    "/me": { get: { operationId: "getMe", responses: { "200": { content: {} } } } },
    ...paths,
  },
  components: { schemas, ...components },
})

const problemsOf = (input: unknown): readonly string[] => {
  try {
    adaptOpenApi(input)
  } catch (error) {
    if (error instanceof OpenApiError) return error.problems
    throw error
  }
  return []
}

const operation = (input: unknown, id: string) =>
  adaptOpenApi(input).operations.find((candidate) => candidate.id === id)
const schema = (input: unknown, id: string) => adaptOpenApi(input).schemas.find((candidate) => candidate.id === id)

describe("adaptOpenApi refuses what it would otherwise get wrong", () => {
  it("refuses a cookie parameter, a plain-text body and an undeclared path parameter", () => {
    const paths = {
      "/a/{id}": {
        post: {
          operationId: "a",
          parameters: [{ name: "session", in: "cookie", schema: { type: "string" } }],
          requestBody: { content: { "text/plain": { schema: { type: "string" } } } },
        },
      },
    }
    expect(problemsOf(document({}, paths))).toEqual([
      '#/paths/~1a~1{id}/post.parameters[0]: parameter "session" is in "cookie"',
      '#/paths/~1a~1{id}/post: path parameter "id" is not declared',
      "#/paths/~1a~1{id}/post: a body must be JSON, multipart or a form, found text/plain",
    ])
  })

  it("names an unknown keyword and a type list it cannot hold as one", () => {
    expect(
      problemsOf(document({ Pet: { prefixItems: [{ type: "string" }] }, Id: { type: ["string", "integer"] } })),
    ).toEqual([
      '#/components/schemas/Pet: unsupported keyword "prefixItems"',
      "#/components/schemas/Pet: a schema with no type",
      '#/components/schemas/Id: a schema of several types ["string","integer"]',
    ])
  })

  it("refuses oneOf beside anyOf, and an allOf of two unions", () => {
    const either = { oneOf: [{ type: "string" }, { type: "integer" }] }
    expect(
      problemsOf(document({ Both: { ...either, anyOf: [{ type: "string" }] }, Two: { allOf: [either, either] } })),
    ).toEqual([
      "#/components/schemas/Both: both oneOf and anyOf on one schema",
      "#/components/schemas/Two: an allOf of several unions",
    ])
  })

  it("refuses an allOf that distributes a union inside itself, instead of recursing forever", () => {
    const base = { type: "object", properties: { id: { type: "string" } } }
    const Loop = { oneOf: [{ type: "string" }, { allOf: [base, { $ref: "#/components/schemas/Loop" }] }] }
    expect(problemsOf(document({ Loop }))).toContain(
      '#/components/schemas/Loop.oneOf[1].union[1].allOf[1]: an allOf distributes the union "Loop" inside itself',
    )
  })
})

// Excerpts of Notion's OpenAPI 3.1 file (developers.notion.com/openapi.json, Notion-Version 2026-03-11), cut to the
// fields that carry the shape.
describe("adaptOpenApi reads the OpenAPI 3.1 shapes Notion's file uses", () => {
  it("reads a null member of anyOf or oneOf as nullable, and collapses the one left", () => {
    const input = document({
      pageIconResponse: {
        oneOf: [
          { $ref: "#/components/schemas/emojiPageIconResponse" },
          { $ref: "#/components/schemas/filePageIconResponse" },
        ],
      },
      emojiPageIconResponse: { type: "object", properties: { emoji: { type: "string" } } },
      filePageIconResponse: { type: "object", properties: { file: { type: "object" } } },
      calloutBlockObjectResponse: {
        type: "object",
        properties: {
          callout: {
            type: "object",
            properties: { icon: { anyOf: [{ $ref: "#/components/schemas/pageIconResponse" }, { type: "null" }] } },
          },
        },
      },
      databasePropertyConfigResponseCommon: {
        type: "object",
        properties: {
          description: {
            oneOf: [{ $ref: "#/components/schemas/propertyDescriptionRequest" }, { type: "null" }],
            description: "The description of the property.",
          },
        },
      },
      propertyDescriptionRequest: { type: "array", items: { type: "object" }, maxItems: 100 },
    })
    expect(schema(input, "calloutBlockObjectResponse")?.schema).toMatchObject({
      properties: { callout: { properties: { icon: { type: "ref", ref: "pageIconResponse", nullable: true } } } },
    })
    expect(schema(input, "databasePropertyConfigResponseCommon")?.schema).toMatchObject({
      properties: {
        description: {
          type: "ref",
          ref: "propertyDescriptionRequest",
          nullable: true,
          description: "The description of the property.",
        },
      },
    })
  })

  it("keeps a nullable union of several members a union", () => {
    const input = document({
      status: {
        anyOf: [
          { type: "null" },
          { type: "object", properties: { checks: { type: "object" } } },
          { type: "object", properties: { error: { type: "object" } } },
        ],
      },
    })
    expect(schema(input, "status")?.schema).toMatchObject({
      type: "union",
      nullable: true,
      of: [{ type: "object" }, { type: "object" }],
    })
  })

  it("reads anyOf as a union", () => {
    const input = document({
      formulaPropertyResponse: {
        anyOf: [
          { $ref: "#/components/schemas/stringFormulaPropertyResponse" },
          { $ref: "#/components/schemas/numberFormulaPropertyResponse" },
        ],
      },
      stringFormulaPropertyResponse: { type: "object", properties: { string: { type: ["string", "null"] } } },
      numberFormulaPropertyResponse: { type: "object", properties: { number: { type: ["number", "null"] } } },
    })
    expect(schema(input, "formulaPropertyResponse")?.schema).toEqual({
      type: "union",
      of: [
        { type: "ref", ref: "stringFormulaPropertyResponse" },
        { type: "ref", ref: "numberFormulaPropertyResponse" },
      ],
    })
  })

  it("takes a field that is only ever null, and a nullable object type list", () => {
    const input = document({
      verificationPropertyUnverifiedResponse: {
        type: "object",
        properties: {
          state: { type: "string", const: "unverified", description: "Always `unverified`" },
          date: { type: "null" },
          verified_by: { type: "null" },
        },
        additionalProperties: false,
        required: ["state", "date", "verified_by"],
        title: "Unverified",
      },
      syncedFrom: {
        title: "Block Id",
        type: ["object", "null"],
        properties: { block_id: { type: "string" }, type: { type: "string", const: "block_id" } },
        additionalProperties: false,
        required: ["block_id"],
      },
    })
    expect(schema(input, "verificationPropertyUnverifiedResponse")?.schema).toMatchObject({
      properties: { date: { type: "unknown" }, verified_by: { type: "unknown" } },
      required: ["state", "date", "verified_by"],
    })
    expect(schema(input, "syncedFrom")?.schema).toMatchObject({
      type: "object",
      nullable: true,
      required: ["block_id"],
    })
  })

  it("distributes an allOf over its union member, inline or behind a reference", () => {
    const common = {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" } },
      required: ["id", "name"],
    }
    const number = { type: "object", properties: { type: { const: "number" }, number: { type: "object" } } }
    const formula = { type: "object", properties: { type: { const: "formula" }, formula: { type: "object" } } }
    const kinds = [
      { $ref: "#/components/schemas/numberDatabasePropertyConfigResponse" },
      { $ref: "#/components/schemas/formulaDatabasePropertyConfigResponse" },
    ]
    const input = document({
      databasePropertyConfigResponseCommon: common,
      numberDatabasePropertyConfigResponse: number,
      formulaDatabasePropertyConfigResponse: formula,
      databasePropertyConfigResponse: {
        allOf: [{ $ref: "#/components/schemas/databasePropertyConfigResponseCommon" }, { oneOf: kinds }],
      },
      kinds: { oneOf: [...kinds, { type: "null" }] },
      viaReference: {
        allOf: [
          { $ref: "#/components/schemas/databasePropertyConfigResponseCommon" },
          { $ref: "#/components/schemas/kinds" },
        ],
        description: "One property.",
      },
    })
    const distributed = {
      type: "union",
      of: [
        {
          type: "allOf",
          of: [
            { type: "ref", ref: "databasePropertyConfigResponseCommon" },
            { type: "ref", ref: "numberDatabasePropertyConfigResponse" },
          ],
        },
        {
          type: "allOf",
          of: [
            { type: "ref", ref: "databasePropertyConfigResponseCommon" },
            { type: "ref", ref: "formulaDatabasePropertyConfigResponse" },
          ],
        },
      ],
    }
    expect(schema(input, "databasePropertyConfigResponse")?.schema).toEqual(distributed)
    expect(schema(input, "viaReference")?.schema).toEqual({
      ...distributed,
      nullable: true,
      description: "One property.",
    })
  })

  it("keeps a lone allOf over a union a described reference", () => {
    const input = document({
      pageIconResponse: { oneOf: [{ type: "string" }, { type: "object" }] },
      icon: { allOf: [{ $ref: "#/components/schemas/pageIconResponse" }], description: "The icon." },
    })
    expect(schema(input, "icon")?.schema).toEqual({ type: "ref", ref: "pageIconResponse", description: "The icon." })
  })

  it("never looks through a reference to a discriminated base", () => {
    const input = document({
      Base: {
        oneOf: [{ $ref: "#/components/schemas/Text" }],
        discriminator: { propertyName: "type", mapping: { text: "#/components/schemas/Text" } },
      },
      Text: { type: "object", properties: { type: { type: "string" } } },
      Extended: {
        allOf: [{ $ref: "#/components/schemas/Base" }, { type: "object", properties: { at: { type: "string" } } }],
      },
    })
    expect(schema(input, "Extended")?.schema).toMatchObject({
      type: "allOf",
      of: [{ type: "ref", ref: "Base" }, { type: "object" }],
    })
  })
})

describe("adaptOpenApi reads OpenAPI 3.1 and the shapes Meta's file uses", () => {
  it("skips a path with no operationId instead of inventing a call", () => {
    const model = adaptOpenApi(document({}, { "/hooks": { post: { requestBody: { content: {} } } } }))
    expect(model.operations.map((candidate) => candidate.id)).toEqual(["getMe"])
  })

  it("resolves a parameter reference and drops the headers the client sets itself", () => {
    const parameters = {
      Authorization: { name: "Authorization", in: "header", required: true, schema: { type: "string" } },
      UserAgent: { name: "User-Agent", in: "header", schema: { type: "string" } },
      Fields: { name: "fields", in: "query", schema: { type: "string" } },
    }
    const paths = {
      "/{Version}/items": {
        parameters: [{ name: "Version", in: "path", required: true, schema: { type: "string" } }],
        get: {
          operationId: "listItems",
          parameters: [
            { $ref: "#/components/parameters/Authorization" },
            { $ref: "#/components/parameters/UserAgent" },
            { $ref: "#/components/parameters/Fields" },
            { name: "Accept", in: "header", schema: { type: "string" } },
          ],
        },
      },
    }
    const found = operation(document({}, paths, { parameters }), "listItems")
    expect(found?.parameters.map(({ name, in: where }) => `${where}:${name}`)).toEqual(["path:Version", "query:fields"])
  })

  it("maps oneOf to a union, const and a typeless enum to their type, and nullable type lists", () => {
    const input = document({
      Media: { oneOf: [{ type: "object", properties: { id: { type: "string" } } }, { type: "string" }] },
      Kind: { type: "string", const: "template" },
      Flag: { const: true },
      Header: { enum: ["header"] },
      Name: { type: ["string", "null"] },
      Anything: { type: "array" },
    })
    expect(schema(input, "Media")?.schema).toMatchObject({
      type: "union",
      of: [{ type: "object" }, { type: "string" }],
    })
    expect(schema(input, "Kind")?.schema).toEqual({ type: "string", enum: ["template"] })
    expect(schema(input, "Flag")?.schema).toEqual({ type: "boolean", enum: [true] })
    expect(schema(input, "Header")?.schema).toEqual({ type: "string", enum: ["header"] })
    expect(schema(input, "Name")?.schema).toEqual({ type: "string", nullable: true })
    expect(schema(input, "Anything")?.schema).toEqual({ type: "array", items: { type: "unknown" } })
  })

  it("reads an allOf member that only lists fields as an object", () => {
    const input = document({
      Base: { type: "object", properties: { type: { type: "string" } } },
      Text: { allOf: [{ $ref: "#/components/schemas/Base" }, { required: ["body"], properties: { body: {} } }] },
    })
    expect(schema(input, "Text")?.schema).toMatchObject({
      type: "allOf",
      of: [
        { type: "ref", ref: "Base" },
        { type: "object", required: ["body"] },
      ],
    })
  })

  it("sends a file upload as multipart even when a JSON body is offered beside it", () => {
    const paths = {
      "/media": {
        post: {
          operationId: "uploadMedia",
          requestBody: {
            content: {
              "application/json": { schema: { type: "object", properties: { file: { type: "string" } } } },
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: { file: { type: "string", format: "binary" }, type: { type: "string" } },
                },
              },
            },
          },
        },
      },
      "/users": {
        post: {
          operationId: "addUser",
          requestBody: {
            content: {
              "application/x-www-form-urlencoded": {
                schema: { type: "object", required: ["user"], properties: { user: { type: "string" } } },
              },
            },
          },
        },
      },
    }
    const input = document({}, paths)
    expect(operation(input, "uploadMedia")?.requestBody).toMatchObject({
      contentType: "multipart/form-data",
      confidence: "contract",
      schema: { type: "object", properties: { file: { type: "string", format: "binary" } } },
    })
    expect(operation(input, "addUser")?.requestBody?.contentType).toBe("application/x-www-form-urlencoded")
  })

  it("marks a body typed only from sample values as an example, never a contract", () => {
    const sampled = {
      type: "object",
      properties: {
        category: { type: "string", example: "MARKETING" },
        tags: { type: "array", items: { type: "string" } },
      },
    }
    const written = { ...sampled, required: ["category"] }
    const body = (bodySchema: unknown) => ({
      post: { operationId: "create", requestBody: { content: { "application/json": { schema: bodySchema } } } },
    })
    expect(operation(document({}, { "/t": body(sampled) }), "create")?.requestBody?.confidence).toBe("example")
    expect(operation(document({}, { "/t": body(written) }), "create")?.requestBody?.confidence).toBe("contract")
  })

  it("leaves a non-JSON answer and a shared response reference unchecked", () => {
    const paths = {
      "/blocked": { get: { operationId: "listBlocked", responses: { "200": { $ref: "#/components/responses/Ok" } } } },
      "/file": { get: { operationId: "download", responses: { "200": { content: { "text/plain": {} } } } } },
    }
    const input = document({}, paths)
    expect(operation(input, "listBlocked")?.response).toBeUndefined()
    expect(operation(input, "download")?.response).toBeUndefined()
  })

  it("keeps a lone allOf as a described reference and ignores vendor extensions", () => {
    const model = adaptOpenApi(
      document({
        ChatId: { type: "integer", format: "int64" },
        Chat: {
          type: "object",
          properties: {
            id: { allOf: [{ $ref: "#/components/schemas/ChatId" }], description: "id", "x-pattern": "\\d+" },
          },
        },
      }),
    )
    expect(model.schemas[1]?.schema).toMatchObject({
      type: "object",
      properties: { id: { type: "ref", ref: "ChatId", description: "id" } },
    })
  })
})

describe("a subtype two discriminators choose", () => {
  const input = document({
    Base: { type: "object", required: ["type"], properties: { type: { type: "string" } } },
    Text: {
      allOf: [{ $ref: "#/components/schemas/Base" }, { type: "object", properties: { body: { type: "string" } } }],
    },
    Other: { allOf: [{ $ref: "#/components/schemas/Base" }], type: "object" },
    Sent: {
      oneOf: [{ $ref: "#/components/schemas/Text" }],
      discriminator: { propertyName: "type", mapping: { text: "#/components/schemas/Text" } },
    },
    Received: {
      oneOf: [{ $ref: "#/components/schemas/Text" }, { $ref: "#/components/schemas/Other" }],
      discriminator: {
        propertyName: "type",
        mapping: {
          text: "#/components/schemas/Text",
          unsupported: "#/components/schemas/Other",
          unknown: "#/components/schemas/Other",
        },
      },
    },
  })
  const [types, schemas] = generate(
    adaptOpenApi(input),
    [typesGenerator({ path: "types.ts" }), valibotGenerator({ path: "schemas.ts", typesImport: "./types.js" })],
    { banner: [] },
  )

  it("keeps one literal when both choose it by the same value", () => {
    expect(types?.content).toContain('export type Text = {\n  type: "text"')
    expect(schemas?.content).toContain('type: v.literal("text")')
  })

  it("accepts every value that selects it", () => {
    expect(types?.content).toContain('type: "unsupported" | "unknown"')
    expect(schemas?.content).toContain('type: v.picklist(["unsupported","unknown"])')
  })
})

describe("Meta's WhatsApp Business Messaging file", () => {
  const model = adaptOpenApi(parse(readFileSync(META, "utf8")))

  it("adapts with no problems, every named operation kept and the webhook description skipped", () => {
    expect(model.operations).toHaveLength(112)
    expect(
      model.operations.some(
        (candidate) => candidate.binding.kind === "http" && candidate.binding.path === "/whatsapp/webhooks",
      ),
    ).toBe(false)
  })

  it("generates types, schemas and a manifest from it", () => {
    const generators = [
      typesGenerator({ path: "types.ts" }),
      valibotGenerator({ path: "schemas.ts", typesImport: "./types.js" }),
      manifestGenerator({ path: "manifest.ts" }),
    ]
    expect(generate(model, generators, { banner: [] }).map((artifact) => artifact.path)).toEqual([
      "types.ts",
      "schemas.ts",
      "manifest.ts",
    ])
  })

  it("uploads media as multipart and keeps the sampled template body an example", () => {
    const byId = (id: string) => model.operations.find((candidate) => candidate.id === id)
    expect(byId("uploadImage")?.requestBody?.contentType).toBe("multipart/form-data")
    expect(byId("createAuthenticationTemplateWOtpCopyCodeButton")?.requestBody?.confidence).toBe("example")
    expect(byId("sendMessage")?.requestBody?.confidence).toBe("contract")
  })
})
