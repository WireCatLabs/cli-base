import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  adaptOpenApi,
  coverageGenerator,
  generate,
  manifestGenerator,
  OpenApiError,
  READING_POST_REASON,
  upgradeToOpenApi3,
} from "./index.js"

// Yandex Disk's REST API description as https://cloud-api.yandex.net/v1/schema served it on 2026-11-16: the Swagger 1.2
// resource listing, and each API declaration fetched from its basePath + path, keyed by that path. Public, no sign-in.
const YANDEX = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../test/fixtures/swagger/yandex-disk-v1.json"), "utf8"),
) as { listing: unknown; declarations: Record<string, unknown> }

const yandex = async () => adaptOpenApi(await upgradeToOpenApi3(YANDEX.listing, YANDEX.declarations))

describe("upgradeToOpenApi3", () => {
  it("reads Yandex Disk's Swagger 1.2: every operation of the six groups, with the server", async () => {
    const model = await yandex()
    expect(model.operations).toHaveLength(25)
    expect(new Set(model.operations.flatMap((operation) => operation.tags)).size).toBe(6)
    expect(model.servers).toEqual([{ url: "https://cloud-api.yandex.net/" }])
    const effects = Object.fromEntries(model.operations.map((operation) => [operation.id, operation.effect]))
    expect(effects).toMatchObject({ GetDisk: "read", DeleteResource: "destructive", ClearTrash: "destructive" })
  })

  it("keeps the answer of an operation that only answers 201 or 202", async () => {
    const model = await yandex()
    const response = (id: string) => model.operations.find((operation) => operation.id === id)?.response?.schema
    expect(response("CreateResource")).toEqual({ type: "ref", ref: "Link" })
    expect(response("UploadExternalResource")).toEqual({ type: "ref", ref: "Link" })
  })

  it("guards Yandex Disk's deletes, overwrites and public links with the CLI's keys, and lists them", async () => {
    const [manifest, coverage] = generate(
      await yandex(),
      [
        manifestGenerator({ path: "manifest.ts" }),
        coverageGenerator({ path: "API.md", title: "Yandex Disk", command: (operation) => operation.command }),
      ],
      {
        banner: [],
        permissions: {
          group: "files",
          deletingFlags: ["permanently", "overwrite"],
          shares: ["PublishResource", "UpdatePublicSettings"],
        },
        auth: {
          securitySchemes: { oauth: { type: "http", scheme: "OAuth" } },
          security: [{ oauth: [] }],
          reason: "the spec has no scheme; the header is Authorization: OAuth <token>",
        },
      },
    )
    expect(coverage?.content).toContain("| `ClearTrash` | `files.delete` | always |")
    expect(coverage?.content).toContain("| `DeleteResource` | `files.delete` | always |")
    expect(coverage?.content).toContain("| `MoveResource` | `files.delete` | query `overwrite` is true |")
    expect(coverage?.content).toContain("| `GetResourceUploadLink` | `files.delete` | query `overwrite` is true |")
    expect(coverage?.content).toContain("| `PublishResource` | `files.share` | always |")
    expect(manifest?.content).toContain("export const securitySchemes: Readonly<Record<string, SecurityScheme>> = {")
    expect(manifest?.content).toContain('"scheme": "OAuth"')
    expect(manifest?.content).toContain("export const servers: readonly ApiServer[] = [")
  })

  it("refuses a share id that matches no operation and a requirement naming no scheme", async () => {
    const model = await yandex()
    expect(() => generate(model, [], { banner: [], permissions: { group: "files", shares: ["Nope"] } })).toThrow(
      'shares: "Nope" matches no operation',
    )
    expect(() =>
      generate(model, [], { banner: [], auth: { securitySchemes: {}, security: [{ oauth: [] }], reason: "x" } }),
    ).toThrow('auth: security names "oauth", which securitySchemes lacks')
  })

  it("upgrades Swagger 2.0 without changing the caller's document, security definitions included", async () => {
    const swagger = {
      swagger: "2.0",
      info: { title: "Shop", version: "1" },
      host: "api.example.com",
      basePath: "/v2",
      schemes: ["https"],
      securityDefinitions: { key: { type: "apiKey", name: "X-Key", in: "header" } },
      security: [{ key: [] }],
      paths: {
        "/orders/search": {
          post: {
            operationId: "searchOrders",
            responses: { "200": { description: "ok", schema: { type: "object" } } },
          },
        },
      },
    }
    const before = structuredClone(swagger)
    const model = adaptOpenApi(await upgradeToOpenApi3(swagger))
    expect(swagger).toEqual(before)
    expect(model.servers).toEqual([{ url: "https://api.example.com/v2" }])
    expect(model.securitySchemes).toEqual({ key: { type: "apiKey", name: "X-Key", in: "header" } })
    expect(model.security).toEqual([{ key: [] }])
    expect(model.operations[0]).toMatchObject({ effect: "read", effectReason: READING_POST_REASON })
  })

  it("returns an OpenAPI 3 document as it is, and refuses what it cannot convert", async () => {
    const openapi = { openapi: "3.1.0", paths: {} }
    expect(await upgradeToOpenApi3(openapi)).toBe(openapi)
    await expect(upgradeToOpenApi3({ swaggerVersion: "1.2", apis: [] })).rejects.toThrow(OpenApiError)
    await expect(upgradeToOpenApi3({ info: {} })).rejects.toThrow(/not an OpenAPI 3, Swagger 2.0 or Swagger 1.x/)
  })
})
