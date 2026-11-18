import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  adaptOpenApi,
  CodegenError,
  generate,
  type ManifestOperation,
  manifestGenerator,
  postmanToOpenApi,
} from "./index.js"

// 18 requests of Braze's own collection, unchanged (see the NOTICE beside it).
const braze = (): { info: Record<string, unknown>; item: Record<string, unknown>[] } =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../../test/fixtures/postman/braze-excerpt.json"), "utf8"))

const problems = (run: () => unknown): string[] => {
  try {
    run()
  } catch (error) {
    if (error instanceof CodegenError) return [...error.problems]
    throw error
  }
  return []
}

const V21 = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
const request = (name: string, method: string, url: unknown, extra: Record<string, unknown> = {}) => ({
  name,
  request: { method, url, ...extra },
})

describe("postmanToOpenApi on Braze's collection", () => {
  const { document, omissions } = postmanToOpenApi(braze(), { variables: { instance_url: "rest.iad-01.braze.com" } })
  const model = adaptOpenApi(document)
  const operation = (id: string) => model.operations.find((one) => one.id === id)

  it("makes each request an operation named by its method and path, tagged with its folders", () => {
    expect(model.operations.map((one) => one.id)).toEqual(
      expect.arrayContaining([
        "getCatalogsByCatalogNameItemsByItemId",
        "patchCatalogsByCatalogNameItemsByItemId",
        "deleteCatalogsByCatalogNameItemsByItemId",
        "getEmailHardBounces",
        "getScimV2UsersById",
        "postSubscriptionStatusSet",
      ]),
    )
    expect(model.operations).toHaveLength(16)
    const item = operation("getCatalogsByCatalogNameItemsByItemId")
    expect(item?.tags).toEqual(["Catalogs / Catalog Items / Synchronous"])
    expect(item?.summary).toBe("List catalog item details")
    expect(item?.parameters.map((one) => [one.in, one.name, one.required])).toEqual([
      ["path", "catalog_name", true],
      ["path", "item_id", true],
    ])
    expect(operation("deleteCatalogsByCatalogNameItemsByItemId")?.effect).toBe("destructive")
    expect(model.servers).toEqual([
      { url: "https://{instance_url}", variables: { instance_url: { default: "rest.iad-01.braze.com" } } },
    ])
  })

  it("reads the query from the URL string, as Braze leaves url.query empty", () => {
    expect(operation("getEmailHardBounces")?.parameters.map((one) => [one.in, one.name, one.required])).toEqual([
      ["query", "start_date", false],
      ["query", "end_date", false],
      ["query", "limit", false],
      ["query", "offset", false],
      ["query", "email", false],
    ])
    expect(operation("getScimV2Users")?.parameters.map((one) => one.name)).toEqual(["filter", "X-Request-Origin"])
  })

  it("signs in with the bearer token of the Authorization header, never a flag, and with nothing on noauth", () => {
    expect(model.securitySchemes).toEqual({ bearer: { type: "http", scheme: "bearer" } })
    expect(operation("getEmailHardBounces")?.security).toEqual([{ bearer: [] }])
    expect(operation("getEmailUnsubscribes")?.security).toEqual([])
    expect(model.operations.flatMap((one) => one.parameters).some((one) => /authorization/i.test(one.name))).toBe(false)
    expect(operation("getScimV2UsersById")?.parameters).toContainEqual(
      expect.objectContaining({ in: "header", name: "X-Request-Origin", required: true }),
    )
  })

  it("keeps a JSON body as an open example, never a contract, and lists what it could not read", () => {
    expect(operation("patchCatalogsByCatalogNameItemsByItemId")?.requestBody).toMatchObject({
      confidence: "example",
      required: true,
      schema: { type: "object", properties: {} },
    })
    expect(operation("postMessagesScheduleCreate")?.requestBody?.confidence).toBe("example")
    expect(omissions).toContain(
      "POST /messages/schedule/create: the body's example is not JSON, so the body is an open object; its notes are left out",
    )
    expect(omissions).toContain("GET /subscription/user/status: the body in graphql mode is left out")
  })

  it("merges a request documented twice on one method and path, and lists the second", () => {
    expect(omissions).toContain(
      'POST /subscription/status/set: "Update user\'s subscription group status" (Subscription Groups / SMS and WhatsApp' +
        " / Update user's subscription group status) merged into \"Update user's subscription group status\", same" +
        " method and path",
    )
    expect(operation("postSubscriptionStatusSet")?.tags).toEqual(["Subscription Groups / Email"])
  })

  it("builds a manifest the api group reads", () => {
    const [manifest] = generate(model, [manifestGenerator({ path: "manifest.ts" })], { banner: [] })
    const text = manifest?.content ?? ""
    const operations = JSON.parse(
      text.slice(text.indexOf("= ", text.indexOf("export const operations")) + 2).split("\n\nexport ")[0] ?? "",
    ) as ManifestOperation[]
    expect(operations.find((one) => one.id === "getEmailHardBounces")).toMatchObject({
      command: "get-email-hard-bounces",
      effect: "read",
      tags: ["Email Lists & Addresses"],
    })
  })
})

describe("postmanToOpenApi on a v2.1 collection", () => {
  const collection = {
    info: { name: "Shop", schema: V21, version: "2.3.0" },
    variable: [{ key: "baseUrl", value: "https://api.shop.example/v1" }],
    auth: {
      type: "apikey",
      apikey: [
        { key: "key", value: "api_key" },
        { key: "in", value: "query" },
      ],
    },
    item: [
      {
        name: "Orders",
        auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}" }] },
        item: [
          request("Get order", "GET", {
            raw: "{{baseUrl}}/orders/:orderId?expand=items",
            query: [{ key: "expand", value: "items", description: "What to include" }],
            variable: [{ key: "orderId", description: "The order" }],
          }),
          request("Ping", "GET", "{{baseUrl}}/ping", { auth: { type: "noauth" } }),
        ],
      },
      request("Upload", "POST", "{{baseUrl}}/files", {
        body: {
          mode: "formdata",
          formdata: [
            { key: "file", type: "file" },
            { key: "name", type: "text" },
          ],
        },
      }),
      request("Login", "POST", "{{baseUrl}}/login", {
        auth: {
          type: "oauth2",
          oauth2: [
            { key: "grant_type", value: "client_credentials" },
            { key: "accessTokenUrl", value: "https://auth.shop.example/token" },
            { key: "scope", value: "orders:read orders:write" },
          ],
        },
        body: { mode: "urlencoded", urlencoded: [{ key: "user" }] },
      }),
    ],
  }
  const { document } = postmanToOpenApi(collection)
  const model = adaptOpenApi(document)
  const operation = (id: string) => model.operations.find((one) => one.id === id)

  it("takes the server from the host variable and :name in the path as a parameter", () => {
    expect(model.servers).toEqual([
      { url: "{baseUrl}", variables: { baseUrl: { default: "https://api.shop.example/v1" } } },
    ])
    expect(model.source.version).toBe("2.3.0")
    expect(operation("getOrdersByOrderId")?.parameters).toMatchObject([
      { in: "path", name: "orderId", required: true, description: "The order" },
      { in: "query", name: "expand", required: false, description: "What to include" },
    ])
  })

  it("inherits the sign-in from the collection and the folder, and maps each to an OpenAPI scheme", () => {
    expect(model.securitySchemes).toEqual({
      bearer: { type: "http", scheme: "bearer" },
      apiKey: { type: "apiKey", name: "api_key", in: "query" },
      oauth2: {
        type: "oauth2",
        flows: {
          clientCredentials: {
            tokenUrl: "https://auth.shop.example/token",
            scopes: { "orders:read": "orders:read", "orders:write": "orders:write" },
          },
        },
      },
    })
    expect(operation("getOrdersByOrderId")?.security).toEqual([{ bearer: [] }])
    expect(operation("getPing")?.security).toEqual([])
    expect(operation("postFiles")?.security).toEqual([{ apiKey: [] }])
    expect(operation("postLogin")?.security).toEqual([{ oauth2: [] }])
  })

  it("sends form fields as a form, and a file field as multipart", () => {
    expect(operation("postFiles")?.requestBody?.contentType).toBe("multipart/form-data")
    expect(operation("postLogin")?.requestBody?.contentType).toBe("application/x-www-form-urlencoded")
  })

  it("stops on what it cannot convert, and on a stale exclusion", () => {
    expect(problems(() => postmanToOpenApi({ info: {}, item: [] }))).toEqual([
      'not a Postman collection v2.0 or v2.1: info.schema is ""',
    ])
    const broken = {
      info: { name: "Broken", schema: V21 },
      item: [
        request("Digest", "GET", "https://{{host}}/a", { auth: { type: "digest", digest: [] } }),
        request("Elsewhere", "GET", "https://other.example/b"),
        request("Nowhere", "GET", ""),
      ],
    }
    expect(problems(() => postmanToOpenApi(broken, { exclude: { "GET /gone": "r" } }))).toEqual([
      "Digest: the digest sign-in has no OpenAPI equivalent; exclude the request with a reason",
      "Elsewhere: on https://other.example, not https://{host}; exclude one with a reason",
      "Nowhere: the request has no URL",
      "the host variable {{host}} has no value; give it in options.variables",
      'exclusion "GET /gone" matches no request — stale, or the request changed',
    ])
    const excluded = postmanToOpenApi(
      { info: { name: "Fixed", schema: V21 }, item: broken.item.slice(0, 2) },
      { exclude: { "GET /a": "digest" } },
    )
    expect(excluded.omissions).toEqual(["GET /a: excluded — digest"])
    expect(Object.keys(excluded.document.paths as object)).toEqual(["/b"])
  })
})
