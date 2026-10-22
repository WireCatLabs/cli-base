import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"
import { adaptOpenApi, generate, manifestGenerator, OpenApiError, typesGenerator, valibotGenerator } from "./index.js"

// facebook/openapi at e96a1c9dbf240c2937b6a95920685230458e346b (2026-08-11), MIT; the LICENSE is beside it.
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
    expect(problemsOf(document({ Pet: { anyOf: [{ type: "string" }] }, Id: { type: ["string", "integer"] } }))).toEqual(
      [
        '#/components/schemas/Pet: unsupported keyword "anyOf"',
        "#/components/schemas/Pet: a schema with no type",
        '#/components/schemas/Id: a schema of several types ["string","integer"]',
      ],
    )
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
