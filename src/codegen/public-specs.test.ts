import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  adaptOpenApi,
  definitionsGenerator,
  fakeApi,
  generate,
  type ManifestOperation,
  manifestGenerator,
  type SchemaNode,
  sampleOf,
  schemaProblems,
  typesGenerator,
  valibotGenerator,
} from "./index.js"

// Cut from Resend's file (resend/resend-openapi at 0b2a456, MIT) and Petstore 3's
// (petstore3.swagger.io/api/v3/openapi.json 1.0.27, Apache-2.0) on 2026-11-17; each LICENSE is beside its excerpt.
// Petstore's answers are cut to one small shape, but for loginUser's, a plain string.
const excerpt = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, `../../test/fixtures/openapi/${name}/openapi-excerpt.json`), "utf8"),
  )

const exported = (content: string | undefined, name: string): unknown => {
  const start = content?.indexOf(`export const ${name}`) ?? -1
  const text = content?.slice(content.indexOf("= ", start) + 2).split("\n\nexport ")[0] ?? ""
  return JSON.parse(text)
}

const built = (name: string) => {
  const model = adaptOpenApi(excerpt(name))
  const [manifest, definitions, types, schemas] = generate(
    model,
    [
      manifestGenerator({ path: "manifest.ts" }),
      definitionsGenerator({ path: "definitions.ts" }),
      typesGenerator({ path: "types.ts" }),
      valibotGenerator({ path: "schemas.ts", typesImport: "./types.js" }),
    ],
    { banner: [] },
  )
  return {
    model,
    operations: exported(manifest?.content, "operations") as ManifestOperation[],
    definitions: exported(definitions?.content, "definitions") as Record<string, SchemaNode>,
    types: types?.content ?? "",
    schemas: schemas?.content ?? "",
  }
}

const RESEND = "https://api.resend.com"
const PETSTORE = "https://petstore3.swagger.io/api/v3"
const TOKEN = "wirecatfake0token42"

describe("Resend's OpenAPI 3.1 fields of several types", () => {
  it("reads a type list as a union of its types, and null in it as nullable", () => {
    const { model, types, schemas } = built("resend")
    const create = model.schemas.find((one) => one.id === "CreateContactOptions")?.schema
    expect(create).toMatchObject({
      properties: {
        properties: {
          type: "object",
          additionalProperties: { type: "union", nullable: true, of: [{ type: "string" }, { type: "number" }] },
        },
      },
    })
    expect(types).toContain("properties?: { [key: string]: (string | number) | null }")
    expect(types).toContain("properties?: { [key: string]: (string | number | boolean) | null }")
    expect(schemas).toContain("v.record(v.string(), v.nullable(v.union([v.string(), number()])))")
  })

  it("reads an allOf of a reference and a description as the described reference, as Resend's template field", () => {
    const model = adaptOpenApi({
      openapi: "3.1.0",
      info: { version: "1" },
      paths: { "/me": { get: { operationId: "getMe" } } },
      components: {
        schemas: {
          Template: { type: "object", properties: { id: { type: "string" } } },
          SendEmailRequest: {
            type: "object",
            properties: {
              template: {
                allOf: [{ $ref: "#/components/schemas/Template" }, { description: "A published template." }],
              },
            },
          },
        },
      },
    })
    const [types] = generate(model, [typesGenerator({ path: "types.ts" })], { banner: [] })
    expect(model.schemas[1]?.schema).toMatchObject({
      properties: { template: { type: "ref", ref: "Template", description: "A published template." } },
    })
    expect(types?.content).toContain("template?: Template")
  })

  it("keeps each type's own enum values and constraints in its member", () => {
    const model = adaptOpenApi({
      openapi: "3.1.0",
      info: { version: "1" },
      paths: { "/me": { get: { operationId: "getMe" } } },
      components: {
        schemas: { Mixed: { type: ["string", "integer", "null"], enum: ["a", 1, null], minLength: 1, maximum: 9 } },
      },
    })
    expect(model.schemas[0]?.schema).toEqual({
      type: "union",
      nullable: true,
      of: [
        { type: "string", enum: ["a"], minLength: 1 },
        { type: "integer", enum: [1], maximum: 9 },
      ],
    })
  })

  it("the strict fake takes each type of the list and refuses a value of another", async () => {
    const { model, operations, definitions } = built("resend")
    const fake = fakeApi({
      operations,
      definitions,
      baseUrl: RESEND,
      security: model.security,
      securitySchemes: model.securitySchemes,
      token: TOKEN,
    })
    const send = (method: string, path: string, body: unknown) =>
      fake.fetch(`${RESEND}${path}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    const properties = { plan: "pro", seats: 3, note: null }
    expect((await send("POST", "/contacts", { email: "a@example.com", properties })).status).toBe(200)
    expect((await send("POST", "/contacts", { email: "a@example.com", properties: { vip: true } })).status).toBe(400)
    expect((await send("PATCH", "/contacts/c1", { properties: { vip: true } })).status).toBe(200)
    expect(fake.refusals).toEqual(["body.properties.vip: matches none of the 2 alternatives"])
  })
})

describe("Resend's other body shapes", () => {
  it("reads anyOf members that only add a required field as the whole object, once with each", () => {
    const { model, definitions } = built("resend")
    const inbox = model.schemas.find((one) => one.id === "UpdateInboxOptions")?.schema
    expect(inbox).toMatchObject({
      type: "union",
      of: [
        { type: "object", required: ["name"], properties: { name: {}, from_name: {} } },
        { type: "object", required: ["from_name"], properties: { name: {}, from_name: {} } },
      ],
    })
    const problems = (value: unknown) => schemaProblems(value, inbox as SchemaNode, definitions)
    expect(problems({ name: "Support" })).toEqual([])
    expect(problems({ from_name: "Ada" })).toEqual([])
    expect(problems({})).toEqual(["body: matches none of the 2 alternatives"])
  })

  it("samples a value a simple pattern and a binary string accept", () => {
    const { model, definitions } = built("resend")
    const label = model.schemas.find((one) => one.id === "CreateInboxLabelOptions")?.schema as SchemaNode
    const sample = sampleOf(label, definitions) as { color: string }
    expect(sample.color).toBe("#000000")
    expect(schemaProblems(sample, label, definitions)).toEqual([])
    expect(sampleOf({ type: "string", format: "binary" }, {})).toBe("attach://xxxxxx")
    expect(sampleOf({ type: "string", pattern: "^(a|b)$" }, {})).toBe("xxxxxx")
  })
})

describe("the document's own sign-in in the fake", () => {
  it("asks a call without its own security for the document's sign-in", async () => {
    const { model, operations, definitions } = built("resend")
    const fake = fakeApi({
      operations,
      definitions,
      baseUrl: RESEND,
      security: model.security,
      securitySchemes: model.securitySchemes,
      token: TOKEN,
    })
    const create = (headers: Record<string, string>) =>
      fake.fetch(`${RESEND}/contacts`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ email: "a@example.com" }),
      })
    expect((await create({})).status).toBe(401)
    expect((await create({ authorization: "Bearer another" })).status).toBe(401)
    expect((await create({ authorization: `Bearer ${TOKEN}` })).status).toBe(200)
    expect(fake.refusals).toEqual([
      "contacts/create: no sign-in where its security names it (bearerAuth)",
      "contacts/create: no sign-in where its security names it (bearerAuth)",
    ])
  })

  it("leaves a call open when the document's security is empty, unless the operation asks for its own", async () => {
    const http = (path: string) => ({ kind: "http" as const, method: "GET" as const, path })
    const operations: ManifestOperation[] = [
      { id: "open", command: "open", binding: http("/open"), effect: "read", tags: [], parameters: [] },
      {
        id: "closed",
        command: "closed",
        binding: http("/closed"),
        effect: "read",
        tags: [],
        parameters: [],
        security: [{ token: [] }],
      },
    ]
    const fake = fakeApi({
      operations,
      definitions: {},
      baseUrl: "https://api.example",
      auth: { header: "Authorization", value: "Bearer t" },
      security: [],
    })
    expect((await fake.fetch("https://api.example/open")).status).toBe(200)
    expect((await fake.fetch("https://api.example/closed")).status).toBe(401)
    expect(fake.refusals).toEqual(["closed: no Authorization header with the expected sign-in"])
  })
})

describe("Petstore 3's upload and its two sign-ins", () => {
  it("reads an application/octet-stream body as bytes, with no schema to check", () => {
    const { model, operations } = built("petstore3")
    expect(model.operations.find((one) => one.id === "uploadFile")?.requestBody).toEqual({
      confidence: "contract",
      required: false,
      contentType: "application/octet-stream",
    })
    expect(operations.find((one) => one.id === "uploadFile")?.request).toEqual({
      required: false,
      confidence: "contract",
      contentType: "application/octet-stream",
    })
  })

  it("the fake takes the upload's bytes as sent, and refuses them under another content type", async () => {
    const { model, operations, definitions } = built("petstore3")
    const fake = fakeApi({
      operations,
      definitions,
      baseUrl: PETSTORE,
      securitySchemes: model.securitySchemes,
      token: TOKEN,
    })
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    const upload = (type: string) =>
      fake.fetch(`${PETSTORE}/pet/7/uploadImage`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": type },
        body: bytes,
      })
    expect((await upload("application/octet-stream")).status).toBe(200)
    expect(fake.calls[0]?.bytes).toEqual(bytes)
    expect((await upload("application/json")).status).toBe(400)
    expect(fake.refusals).toEqual(["uploadFile: the body is sent as application/json, not application/octet-stream"])
  })

  it("checks the sign-in each operation's own schemes name: an api_key header, OAuth's bearer token, or none", async () => {
    const { model, operations, definitions } = built("petstore3")
    const fake = fakeApi({
      operations,
      definitions,
      baseUrl: PETSTORE,
      securitySchemes: model.securitySchemes,
      token: TOKEN,
    })
    const status = async (path: string, headers: Record<string, string> = {}) =>
      (await fake.fetch(`${PETSTORE}${path}`, { headers })).status
    expect(await status("/store/inventory", { api_key: TOKEN })).toBe(200)
    expect(await status("/store/inventory", { authorization: `Bearer ${TOKEN}` })).toBe(401)
    expect(await status("/pet/7", { api_key: TOKEN })).toBe(200)
    expect(await status("/pet/7", { authorization: `Bearer ${TOKEN}` })).toBe(200)
    expect(await status("/user/ann")).toBe(200)
    expect(fake.refusals).toEqual(["getInventory: no sign-in where its security names it (api_key)"])
  })

  it("the fake answers a string schema with JSON text, as Petstore's loginUser answers", async () => {
    const { operations, definitions } = built("petstore3")
    const fake = fakeApi({ operations, definitions, baseUrl: PETSTORE })
    const answer = await fake.fetch(`${PETSTORE}/user/login?username=ann&password=x`)
    expect(answer.headers.get("content-type")).toBe("application/json")
    expect(await answer.json()).toBe("xxxxxx")
  })
})
