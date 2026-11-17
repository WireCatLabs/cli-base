import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  adaptOpenApi,
  coverageGenerator,
  generate,
  manifestGenerator,
  OpenApiError,
  patchSpec,
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
    expect(coverage?.content).toContain(
      "Not from the source: the spec has no scheme; the header is Authorization: OAuth <token>",
    )
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
    expect(model.operations[0]?.effect).toBe("write")
  })

  it("returns an OpenAPI 3 document as it is, and refuses what it cannot convert", async () => {
    const openapi = { openapi: "3.1.0", paths: {} }
    expect(await upgradeToOpenApi3(openapi)).toBe(openapi)
    await expect(upgradeToOpenApi3({ swaggerVersion: "1.2", apis: [] })).rejects.toThrow(OpenApiError)
    await expect(upgradeToOpenApi3({ info: {} })).rejects.toThrow(/not an OpenAPI 3, Swagger 2.0 or Swagger 1.x/)
  })
})

describe("command names and spec patches", () => {
  const hubspot = {
    openapi: "3.0.1",
    info: { version: "v3" },
    paths: {
      "/crm/v3/objects/0-3": {
        get: { operationId: "get-/crm/v3/objects/0-3_getPage" },
        post: { operationId: "post-/crm/v3/objects/0-3_create" },
      },
      "/crm/v3/objects/0-3/{dealId}": {
        parameters: [{ name: "dealId", in: "path", schema: { type: "string" } }],
        get: { operationId: "get-/crm/v3/objects/0-3/{dealId}_getById" },
        delete: { operationId: "delete-/crm/v3/objects/0-3/{dealId}_archive" },
      },
      "/crm/v3/objects/0-3/batch/archive": {
        post: {
          operationId: "post-/crm/v3/objects/0-3/batch/archive_archive",
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Void" } } } },
        },
      },
    },
    components: { schemas: {} },
  }

  it("names commands from the path with segment aliases, an explicit name winning", () => {
    const { document } = patchSpec(hubspot, { stubMissingSchemas: "missing from HubSpot's associations spec" })
    const [manifest] = generate(adaptOpenApi(document), [manifestGenerator({ path: "manifest.ts" })], {
      banner: [],
      names: {
        fromPath: true,
        segments: { "0-3": "deals", crm: "", objects: "" },
        commands: { "post-/crm/v3/objects/0-3/batch/archive_archive": "deals-archive-batch" },
      },
    })
    const commands = [...(manifest?.content.matchAll(/"command": "([^"]+)"/g) ?? [])].map(([, command]) => command)
    expect(commands).toEqual(["deals-list", "deals-create", "deals-get", "deals-delete", "deals-archive-batch"])
  })

  it("names a read of `/me` as one item, not a list", () => {
    const notion = {
      openapi: "3.1.0",
      info: { version: "1" },
      paths: {
        "/v1/users": { get: { operationId: "get-users" } },
        "/v1/users/me": { get: { operationId: "get-self" } },
        "/v1/blocks/{block_id}/children": {
          parameters: [{ name: "block_id", in: "path", required: true, schema: { type: "string" } }],
          get: { operationId: "get-block-children" },
        },
      },
      components: { schemas: {} },
    }
    const [manifest] = generate(adaptOpenApi(notion), [manifestGenerator({ path: "manifest.ts" })], {
      banner: [],
      names: { fromPath: true },
    })
    const commands = [...(manifest?.content.matchAll(/"command": "([^"]+)"/g) ?? [])].map(([, command]) => command)
    expect(commands).toEqual(["users-list", "users-me-get", "blocks-children-list"])
  })

  it("names a PUT on a collection beside a PUT on its item upsert, so the two do not clash", () => {
    const id = [{ name: "record_id", in: "path", required: true, schema: { type: "string" } }]
    const attio = {
      openapi: "3.1.0",
      info: {},
      paths: {
        "/v2/records": { put: { operationId: "assert" } },
        "/v2/records/{record_id}": { parameters: id, put: { operationId: "replace" } },
        "/v2/notes": { get: { operationId: "notes" }, put: { operationId: "notes-put" } },
      },
      components: { schemas: {} },
    }
    const [manifest] = generate(adaptOpenApi(attio), [manifestGenerator({ path: "manifest.ts" })], {
      banner: [],
      names: { fromPath: true },
    })
    const commands = [...(manifest?.content.matchAll(/"command": "([^"]+)"/g) ?? [])].map(([, command]) => command)
    expect(commands).toEqual(["records-upsert", "records-replace", "notes-list", "notes-replace"])
  })

  it("refuses a name for an unknown operation or one that is not kebab case", () => {
    const { document } = patchSpec(hubspot, { stubMissingSchemas: "missing" })
    const run = (commands: Record<string, string>) =>
      generate(adaptOpenApi(document), [], { banner: [], names: { commands } })
    expect(() => run({ nope: "deals-list" })).toThrow('names: "nope" matches no operation')
    expect(() => run({ "get-/crm/v3/objects/0-3_getPage": "Deals List" })).toThrow(
      'gets "Deals List", not a kebab-case command',
    )
  })

  it("stubs a missing schema and sets a value by pointer, leaving the caller's document alone and listing both", () => {
    const before = structuredClone(hubspot)
    const { document, applied } = patchSpec(hubspot, {
      stubMissingSchemas: "missing from HubSpot's associations spec",
      patches: [{ pointer: "/info/title", value: "HubSpot CRM", reason: "the spec has no title" }],
    })
    expect(hubspot).toEqual(before)
    expect(applied).toEqual([
      { pointer: "/info/title", reason: "the spec has no title" },
      { pointer: "/components/schemas/Void", reason: "missing from HubSpot's associations spec" },
    ])
    expect(adaptOpenApi(document).schemas).toEqual([
      { id: "Void", schema: { type: "unknown", description: expect.any(String) } },
    ])
    expect(() => patchSpec(hubspot, { patches: [{ pointer: "/nowhere/x", value: 1, reason: "r" }] })).toThrow(
      "patch /nowhere/x: its parent is not in the document",
    )
  })
  it("refuses a path that names no command, and patches into an array but never the prototype", () => {
    const root = { openapi: "3.0.1", info: {}, paths: { "/v3": { post: { operationId: "root" } } } }
    expect(() => generate(adaptOpenApi(root), [], { banner: [], names: { fromPath: true } })).toThrow(
      'names: operation "root" (POST /v3) gets "", not a kebab-case command; map it in commands',
    )
    const withParameter = {
      ...root,
      paths: {
        "/x": { get: { operationId: "x", parameters: [{ name: "a", in: "query", schema: { type: "string" } }] } },
      },
    }
    const { document } = patchSpec(withParameter, {
      patches: [{ pointer: "/paths/~1x/get/parameters/0/name", value: "b", reason: "the docs call it b" }],
    })
    expect(adaptOpenApi(document).operations[0]?.parameters[0]?.name).toBe("b")
    expect(() => patchSpec(root, { patches: [{ pointer: "/__proto__/polluted", value: 1, reason: "r" }] })).toThrow(
      "are not document keys",
    )
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
