import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  adaptOpenApi,
  coverageGenerator,
  definitionsGenerator,
  fakeApi,
  generate,
  type ManifestOperation,
  manifestGenerator,
  type SchemaNode,
  sampleOf,
  upgradeToOpenApi3,
} from "./index.js"

// Yandex Disk's Swagger 1.2 description as served on 2026-11-16; see swagger.test.ts.
const YANDEX = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../test/fixtures/swagger/yandex-disk-v1.json"), "utf8"),
) as { listing: unknown; declarations: Record<string, unknown> }

const exported = (content: string | undefined, name: string): unknown => {
  const start = content?.indexOf(`export const ${name}`) ?? -1
  const text = content?.slice(content.indexOf("= ", start) + 2).split("\n\nexport ")[0] ?? ""
  return JSON.parse(text)
}

const yandex = async (options: Parameters<typeof generate>[2] = { banner: [] }) => {
  const model = adaptOpenApi(await upgradeToOpenApi3(YANDEX.listing, YANDEX.declarations))
  const [manifest, definitions, coverage] = generate(
    model,
    [
      manifestGenerator({ path: "manifest.ts" }),
      definitionsGenerator({ path: "definitions.ts" }),
      coverageGenerator({ path: "API.md", title: "Yandex Disk", command: (operation) => operation.command }),
    ],
    options,
  )
  return {
    operations: exported(manifest?.content, "operations") as ManifestOperation[],
    definitions: exported(definitions?.content, "definitions") as Record<string, SchemaNode>,
    coverage: coverage?.content ?? "",
  }
}

const BASE = "https://cloud-api.yandex.net"
const TOKEN = { header: "Authorization", value: "OAuth wirecatfake0token42" }
const signed = { headers: { Authorization: TOKEN.value } }

describe("pagination in the manifest", () => {
  it("finds Yandex Disk's offset pages, the nested _embedded.items included, and lists them", async () => {
    const { operations, coverage } = await yandex({ banner: [], pagination: true })
    const page = (id: string) => operations.find((operation) => operation.id === id)?.pagination
    expect(page("GetResource")).toEqual({
      style: "offset",
      offset: { in: "query", name: "offset" },
      limit: { in: "query", name: "limit" },
      items: "_embedded.items",
      total: "_embedded.total",
    })
    expect(page("GetFlatFilesList")).toMatchObject({ style: "offset", items: "items" })
    expect(page("GetLastUploadedFilesList")).toBeUndefined()
    expect(coverage).toContain("| `GetResource` | offset | query `offset`, query `limit` | items `_embedded.items`")
  })

  it("finds a cursor in the answer under the request's own name, and takes an override over detection", () => {
    const document = {
      openapi: "3.0.1",
      info: {},
      paths: {
        "/contacts": {
          get: {
            operationId: "list",
            parameters: [
              { name: "after", in: "query", schema: { type: "string" } },
              { name: "limit", in: "query", schema: { type: "integer" } },
            ],
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        results: { type: "array", items: { type: "string" } },
                        paging: {
                          type: "object",
                          properties: { next: { type: "object", properties: { after: { type: "string" } } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }
    const pageOf = (options: Parameters<typeof generate>[2]) =>
      (
        exported(
          generate(adaptOpenApi(document), [manifestGenerator({ path: "m.ts" })], options)[0]?.content,
          "operations",
        ) as ManifestOperation[]
      )[0]?.pagination
    expect(pageOf({ banner: [] })).toBeUndefined()
    expect(pageOf({ banner: [], pagination: true })).toEqual({
      style: "cursor",
      cursor: { in: "query", name: "after" },
      next: "paging.next.after",
      items: "results",
      limit: { in: "query", name: "limit" },
    })
    expect(
      pageOf({ banner: [], pagination: true, overrides: { list: { pagination: null, reason: "one page only" } } }),
    ).toBeUndefined()
    expect(() =>
      pageOf({
        banner: [],
        overrides: {
          list: { reason: "x", pagination: { style: "cursor", cursor: { in: "body", name: "after" }, next: "next" } },
        },
      }),
    ).toThrow('override "list": pagination names body "after", which the operation does not take')
  })
})

describe("fakeApi", () => {
  it("answers a known call with a sample that matches the answer's schema", async () => {
    const { operations, definitions } = await yandex()
    const fake = fakeApi({ operations, definitions, baseUrl: BASE, auth: TOKEN })
    const answer = await fake.fetch(`${BASE}/v1/disk/resources?path=disk%3A%2Fa&limit=10`, signed)
    expect(answer.status).toBe(200)
    expect(await answer.json()).toMatchObject({ path: expect.any(String) })
    expect(fake.refusals).toEqual([])
    expect(fake.calls[0]).toMatchObject({ operation: "GetResource", query: { path: "disk:/a", limit: "10" } })
  })

  it("refuses an unknown path, method, query parameter or value, a missing parameter and a missing sign-in", async () => {
    const { operations, definitions } = await yandex()
    const fake = fakeApi({ operations, definitions, baseUrl: BASE, auth: TOKEN })
    const status = async (url: string, init: RequestInit = signed) => (await fake.fetch(url, init)).status
    expect(await status(`${BASE}/v1/disk/nothing`)).toBe(404)
    expect(await status(`${BASE}/v1/disk`, { ...signed, method: "POST" })).toBe(405)
    expect(await status(`${BASE}/v1/disk/resources?path=a&pathh=b`)).toBe(400)
    expect(await status(`${BASE}/v1/disk/resources?path=a&limit=many`)).toBe(400)
    expect(await status(`${BASE}/v1/disk/resources`)).toBe(400)
    expect(await status(`${BASE}/v1/disk`, {})).toBe(401)
    expect(fake.refusals).toEqual([
      "no operation is GET /v1/disk/nothing",
      "no operation is POST /v1/disk",
      'GetResource: no query parameter "pathh"',
      "query.limit: expected an integer",
      'GetResource: query parameter "path" is required',
      "GetDisk: no Authorization header with the expected sign-in",
    ])
  })

  it("checks a body field by field and refuses an answer off the schema", async () => {
    const { operations, definitions } = await yandex()
    const fake = fakeApi({
      operations,
      definitions,
      baseUrl: BASE,
      auth: TOKEN,
      answers: { UpdateResource: () => ({ body: { path: 42 } }) },
    })
    const patch = (body: unknown) =>
      fake.fetch(`${BASE}/v1/disk/resources?path=a`, { ...signed, method: "PATCH", body: JSON.stringify(body) })
    expect((await patch({ custom_propertiez: {} })).status).toBe(400)
    expect(fake.refusals).toEqual(["body.custom_propertiez: no such field"])
    await expect(patch({ custom_properties: {} })).rejects.toThrow("the answer for UpdateResource breaks its schema")
  })

  it("serves a link host without the token, and refuses the token sent there", async () => {
    const { operations, definitions } = await yandex()
    const fake = fakeApi({
      operations,
      definitions,
      baseUrl: BASE,
      auth: TOKEN,
      hosts: { "downloader.disk.yandex.ru": () => ({ body: { ok: true } }) },
    })
    expect((await fake.fetch("https://downloader.disk.yandex.ru/file")).status).toBe(200)
    expect((await fake.fetch("https://downloader.disk.yandex.ru/file", signed)).status).toBe(400)
    expect((await fake.fetch("https://elsewhere.example/file")).status).toBe(404)
    expect(fake.refusals).toEqual([
      "the Authorization header was sent to downloader.disk.yandex.ru, which is not the service",
      "elsewhere.example is not a host this fake knows",
    ])
  })

  it("builds a sample from a schema that contains itself", () => {
    const definitions: Record<string, SchemaNode> = {
      Folder: {
        type: "object",
        properties: { name: { type: "string" }, parent: { type: "ref", ref: "Folder" } },
        required: ["name"],
      },
    }
    expect(sampleOf({ type: "ref", ref: "Folder" }, definitions)).toEqual({ name: "xxxxxx" })
  })
  it("reads repeated query values as a list, prefers a literal path, and serves bytes and open calls", async () => {
    const http = (method: "GET" | "PATCH", path: string) => ({ kind: "http" as const, method, path })
    const operations: ManifestOperation[] = [
      {
        id: "byId",
        command: "by-id",
        binding: http("GET", "/a/{id}"),
        effect: "read",
        tags: [],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      },
      {
        id: "literal",
        command: "literal",
        binding: http("GET", "/a/b"),
        effect: "read",
        tags: [],
        security: [],
        parameters: [
          {
            name: "properties",
            in: "query",
            required: false,
            schema: { type: "array", items: { type: "string", pattern: "^[a-z\\_]+$" } },
          },
        ],
      },
      {
        id: "patch",
        command: "patch",
        binding: http("PATCH", "/a/{id}"),
        effect: "write",
        tags: [],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        request: {
          required: true,
          confidence: "contract",
          schema: "Patch",
          contentType: "application/merge-patch+json",
        },
      },
    ]
    const definitions: Record<string, SchemaNode> = {
      Patch: { type: "object", properties: { name: { type: "string" } }, required: [] },
    }
    const fake = fakeApi({
      operations,
      definitions,
      baseUrl: "https://api.example",
      auth: { header: "Authorization", value: "Bearer t" },
      hosts: { "*.files.example": () => ({ body: "file bytes", headers: { "content-type": "text/plain" } }) },
    })
    const answer = await fake.fetch("https://api.example/a/b?properties=first_name&properties=email")
    expect(answer.status).toBe(200)
    expect(fake.calls[0]).toMatchObject({ operation: "literal", query: { properties: ["first_name", "email"] } })
    const merge = (body: unknown) =>
      fake.fetch("https://api.example/a/1", {
        method: "PATCH",
        headers: { Authorization: "Bearer t", "content-type": "application/merge-patch+json" },
        body: JSON.stringify(body),
      })
    expect((await merge({ nmae: "x" })).status).toBe(400)
    expect((await merge({ name: "x" })).status).toBe(200)
    expect(await (await fake.fetch("https://u7.files.example/f")).text()).toBe("file bytes")
    expect((await fake.fetch("http://u7.files.example/f")).status).toBe(400)
    expect(fake.refusals).toEqual(["body.nmae: no such field", "u7.files.example was called over http:"])
  })

  it("takes a user name and password by Basic, and refuses them in base64 on another host", async () => {
    const fake = fakeApi({
      operations: [
        {
          id: "me",
          command: "me",
          binding: { kind: "http", method: "GET", path: "/users/me" },
          effect: "read",
          tags: [],
          parameters: [],
          response: { confidence: "contract", schema: "Me" },
        },
      ],
      definitions: { Me: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
      baseUrl: "https://blog.example/wp-json/wp/v2",
      securitySchemes: { app: { type: "http", scheme: "basic" } },
      security: [{ app: [] }],
      token: "editor:abcd efgh",
      hosts: { "cdn.example": () => ({ body: {} }) },
    })
    const me = "https://blog.example/wp-json/wp/v2/users/me"
    const basic = (pair: string) => ({ headers: { authorization: `Basic ${btoa(pair)}` } })
    expect((await fake.fetch(me, basic("editor:abcd efgh"))).status).toBe(200)
    expect((await fake.fetch(me, basic("editor:wrong"))).status).toBe(401)
    expect((await fake.fetch("https://cdn.example/a.png", basic("editor:abcd efgh"))).status).toBe(400)
    expect(fake.refusals).toEqual([
      "me: no sign-in where its security names it (app)",
      "the token was sent to cdn.example, which is not the service",
    ])
  })
})

describe("pagination detection does not guess", () => {
  const read = (parameters: unknown[], answer: Record<string, unknown>) => ({
    openapi: "3.0.1",
    info: {},
    paths: {
      "/events": {
        get: {
          operationId: "events",
          parameters,
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: answer } } } },
          },
        },
      },
    },
  })
  const pageOf = (document: unknown, overrides = {}) =>
    (
      exported(
        generate(adaptOpenApi(document), [manifestGenerator({ path: "m.ts" })], {
          banner: [],
          pagination: true,
          overrides,
        })[0]?.content,
        "operations",
      ) as ManifestOperation[]
    )[0]?.pagination

  it("takes no date for an offset and no page count for a total", () => {
    const attendees = { attendees: { type: "array", items: { type: "string" } } }
    expect(
      pageOf(read([{ name: "start", in: "query", schema: { type: "string", format: "date" } }], attendees)),
    ).toBeUndefined()
    const counted = read(
      [
        { name: "offset", in: "query", schema: { type: "integer" } },
        { name: "count", in: "query", schema: { type: "integer" } },
      ],
      { items: { type: "array", items: { type: "string" } }, count: { type: "integer" } },
    )
    expect(pageOf(counted)).toEqual({
      style: "offset",
      offset: { in: "query", name: "offset" },
      limit: { in: "query", name: "count" },
      items: "items",
    })
  })

  it("refuses an override whose answer path is not in the answer", () => {
    const document = read([{ name: "after", in: "query", schema: { type: "string" } }], { next: { type: "string" } })
    const override = (next: string) => ({
      events: { reason: "x", pagination: { style: "cursor", cursor: { in: "query", name: "after" }, next } },
    })
    expect(pageOf(document, override("next"))).toMatchObject({ style: "cursor", next: "next" })
    expect(() => pageOf(document, override("next_cursr"))).toThrow(
      'reads next from "next_cursr", which the answer lacks',
    )
  })
})
