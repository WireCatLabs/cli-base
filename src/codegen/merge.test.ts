import { describe, expect, it } from "vitest"
import { adaptOpenApi, mergeOpenApi, OpenApiError } from "./index.js"

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const answer = (schema: unknown) => ({ "200": { content: { "application/json": { schema } } } })

const spec = (
  object: string,
  paging: unknown,
  extra: { paths?: Record<string, unknown>; scopes?: Record<string, string>; openapi?: string } = {},
) => ({
  openapi: extra.openapi ?? "3.0.1",
  info: { title: `CRM ${object}`, version: "v3" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    [`/crm/v3/objects/${object}`]: {
      get: { operationId: `${object}-list`, responses: answer(ref("Collection")) },
    },
    ...extra.paths,
  },
  components: {
    schemas: {
      Collection: { type: "object", properties: { results: { type: "array", items: {} }, paging: ref("Paging") } },
      Paging: paging,
    },
    securitySchemes: {
      oauth2: {
        type: "oauth2",
        flows: {
          authorizationCode: { authorizationUrl: "https://a", tokenUrl: "https://t", scopes: extra.scopes ?? {} },
        },
      },
    },
  },
})

const paging = { type: "object", properties: { next: { type: "string" } } }
const shared = {
  "/crm/v4/associations/{from}/{to}": {
    parameters: [
      { name: "from", in: "path", required: true, schema: { type: "string" } },
      { name: "to", in: "path", required: true, schema: { type: "string" } },
    ],
    put: { operationId: "associate" },
  },
}

const problemsOf = (run: () => unknown): readonly string[] => {
  try {
    run()
  } catch (error) {
    if (error instanceof OpenApiError) return error.problems
    throw error
  }
  return []
}

describe("mergeOpenApi", () => {
  it("keeps one copy of a component that differs only in its text, and lists each source", () => {
    const { document, report } = mergeOpenApi(
      [
        { name: "contacts", document: spec("contacts", paging), url: "https://specs.example/contacts" },
        { name: "deals", document: spec("deals", { ...paging, description: "Where the next page starts." }) },
      ],
      { title: "CRM", version: "v3" },
    )
    expect(Object.keys((document.components as { schemas: object }).schemas)).toEqual(["Collection", "Paging"])
    expect(report.merged).toEqual(["schemas/Collection", "schemas/Paging"])
    expect(report.renamed).toEqual([])
    expect(report.sources.map(({ name, url, operations }) => ({ name, url, operations }))).toEqual([
      { name: "contacts", url: "https://specs.example/contacts", operations: 1 },
      { name: "deals", url: undefined, operations: 1 },
    ])
    expect(report.sources[0]?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(adaptOpenApi(document).operations.map((operation) => operation.id)).toEqual(["contacts-list", "deals-list"])
  })

  it("renames a real difference and what refers to it under the source's prefix, pointing its references there", () => {
    const { document, report } = mergeOpenApi(
      [
        { name: "contacts", document: spec("contacts", paging) },
        {
          name: "line-items",
          document: spec("line_items", { type: "object", properties: { after: { type: "integer" } } }),
        },
      ],
      { title: "CRM", version: "v3" },
    )
    const schemas = (document.components as { schemas: Record<string, { properties?: object }> }).schemas
    expect(report.renamed).toEqual([
      "schemas/Collection → LineItemsCollection (line-items)",
      "schemas/Paging → LineItemsPaging (line-items)",
    ])
    expect(Object.keys(schemas)).toEqual(["Collection", "Paging", "LineItemsCollection", "LineItemsPaging"])
    expect(schemas.LineItemsCollection?.properties).toMatchObject({ paging: ref("LineItemsPaging") })
    const model = adaptOpenApi(document)
    expect(model.operations.find((one) => one.id === "line_items-list")?.response?.schema).toEqual({
      type: "ref",
      ref: "LineItemsCollection",
    })
  })

  it("takes a path two sources share once, and joins their OAuth scopes", () => {
    const { document, report } = mergeOpenApi(
      [
        { name: "contacts", document: spec("contacts", paging, { paths: shared, scopes: { "contacts.read": "r" } }) },
        { name: "deals", document: spec("deals", paging, { paths: shared, scopes: { "deals.read": "r" } }) },
      ],
      { title: "CRM", version: "v3" },
    )
    expect(report.sharedPaths).toEqual(["/crm/v4/associations/{from}/{to} (deals)"])
    const schemes = (
      document.components as { securitySchemes: Record<string, { flows: { authorizationCode: { scopes: object } } }> }
    ).securitySchemes
    expect(schemes.oauth2?.flows.authorizationCode.scopes).toEqual({ "contacts.read": "r", "deals.read": "r" })
    expect(document.servers).toEqual([{ url: "https://api.example.com" }])
  })

  it("refuses a shared path with other operations, a repeated operation id, mixed versions and a non-OpenAPI source", () => {
    const other = {
      "/crm/v4/associations/{from}/{to}": {
        ...shared["/crm/v4/associations/{from}/{to}"],
        delete: { operationId: "dissociate" },
      },
    }
    const repeated = { "/crm/v3/other": { get: { operationId: "contacts-list" } } }
    expect(
      problemsOf(() =>
        mergeOpenApi(
          [
            { name: "contacts", document: spec("contacts", paging, { paths: shared }) },
            { name: "deals", document: spec("deals", paging, { paths: { ...other, ...repeated } }) },
            { name: "notes", document: spec("notes", paging, { openapi: "3.1.0" }) },
            { name: "swagger", document: { swagger: "2.0" } },
          ],
          { title: "CRM", version: "v3" },
        ),
      ),
    ).toEqual([
      "deals: /crm/v4/associations/{from}/{to} has other operations than an earlier source's",
      'deals: operation id "contacts-list" is also contacts\'s',
      "swagger: not an OpenAPI 3 document",
      "the sources mix OpenAPI versions 3.0.1, 3.1.0; convert them to one first",
    ])
  })
})
