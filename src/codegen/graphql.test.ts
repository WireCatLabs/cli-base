import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { trackerIntrospection } from "../../test/fixtures/graphql-tracker.js"
import {
  adaptGraphql,
  CodegenError,
  coverageGenerator,
  definitionsGenerator,
  type GraphqlBinding,
  generate,
  graphqlDocument,
  graphqlFake,
  INTROSPECTION_QUERY,
  type ManifestOperation,
  manifestGenerator,
  parseSelection,
  readGraphql,
  type SchemaNode,
  syncGraphql,
  typesGenerator,
  valibotGenerator,
} from "./index.js"

const URL_ = "https://api.tracker.example/graphql"
const scalars = { DateTime: { type: "string" } } as const
const model = () => adaptGraphql(trackerIntrospection(), { url: URL_, scalars })
const operation = (id: string) => {
  const found = model().operations.find((one) => one.id === id)
  if (!found) throw new Error(`no ${id}`)
  return found
}

/** What a CLI's pnpm generate writes, read back as the manifest and definitions a fake takes. */
const generated = () => {
  const artifacts = generate(
    model(),
    [manifestGenerator({ path: "manifest.ts" }), definitionsGenerator({ path: "definitions.ts" })],
    { banner: [], permissions: { group: "issues" } },
  )
  const constant = (path: string, name: string) => {
    const content = artifacts.find((one) => one.path === path)?.content ?? ""
    const start = content.indexOf("=", content.indexOf(`export const ${name}`)) + 1
    const end = content.indexOf("\n\nexport const", start)
    return JSON.parse(content.slice(start, end < 0 ? undefined : end))
  }
  return {
    operations: constant("manifest.ts", "operations") as ManifestOperation[],
    definitions: constant("definitions.ts", "definitions") as Record<string, SchemaNode>,
  }
}

describe("adaptGraphql", () => {
  it("makes one operation of each Query and Mutation field, with the effect its kind and name say", () => {
    const effects = Object.fromEntries(model().operations.map((one) => [one.id, one.effect]))
    expect(effects).toEqual({
      issue: "read",
      issueArchive: "destructive",
      issueCreate: "write",
      issueDelete: "destructive",
      issueUnarchive: "write",
      issues: "read",
      teams: "read",
      users: "read",
      viewer: "read",
      workflowStates: "read",
    })
  })

  it("binds a field with its variables' GraphQL types and a default selection one level deep", () => {
    const issues = operation("issues")
    expect(issues.binding).toEqual({
      kind: "graphql",
      operation: "query",
      field: "issues",
      variables: {
        first: "Int",
        after: "String",
        filter: "IssueFilter",
        includeArchived: "Boolean",
        orderBy: "PaginationOrderBy",
      },
      selection:
        "nodes { id identifier title description priority createdAt updatedAt archivedAt state { id } team { id } assignee { id } } pageInfo { hasNextPage endCursor }",
    })
    expect(operation("issue").binding).toMatchObject({
      variables: { id: "String!" },
      selection:
        "id identifier title description priority createdAt updatedAt archivedAt state { id } team { id } assignee { id }",
    })
    expect(operation("issueDelete").binding).toMatchObject({ operation: "mutation", selection: "success" })
  })

  it("makes each argument a body flag and the variables the request body", () => {
    const issue = operation("issue")
    expect(issue.parameters).toEqual([{ name: "id", in: "body", required: true, schema: { type: "string" } }])
    expect(issue.requestBody).toMatchObject({ required: true, schema: { type: "object", required: ["id"] } })
    expect(operation("viewer").requestBody).toBeUndefined()
    const create = model().schemas.find((one) => one.id === "IssueCreateInput")?.schema
    // A non-null field with a default may be left out.
    expect(create).toMatchObject({ type: "object", required: ["title", "teamId"] })
  })

  it("pages a Relay connection as a cursor in the variables", () => {
    expect(operation("issues").pagination).toEqual({
      style: "cursor",
      cursor: { in: "body", name: "after" },
      next: "pageInfo.endCursor",
      items: "nodes",
      hasMore: "pageInfo.hasNextPage",
      limit: { in: "body", name: "first" },
    })
    expect(operation("viewer").pagination).toBeUndefined()
    expect(operation("issue").pagination).toBeUndefined()
  })

  it("stops on a scalar it was not told the shape of", () => {
    expect(() => adaptGraphql(trackerIntrospection(), { url: URL_ })).toThrow(/scalar DateTime: map it in scalars/)
  })

  it("leaves out an excluded field, and stops on an exclusion that matches none", () => {
    const left = adaptGraphql(trackerIntrospection(), { url: URL_, scalars, exclude: { viewer: "not needed" } })
    expect(left.operations.map((one) => one.id)).not.toContain("viewer")
    expect(() => adaptGraphql(trackerIntrospection(), { url: URL_, scalars, exclude: { nope: "x" } })).toThrow(
      CodegenError,
    )
  })

  it("goes through generate: types, schemas, manifest, coverage and the delete keys", () => {
    const artifacts = generate(
      model(),
      [
        typesGenerator({ path: "types.ts" }),
        valibotGenerator({ path: "schemas.ts", typesImport: "./types.js" }),
        manifestGenerator({ path: "manifest.ts" }),
        coverageGenerator({ path: "API.md", title: "API", command: (one) => `tracker api ${one.command}` }),
      ],
      { banner: [], permissions: { group: "issues" } },
    )
    const text = (path: string) => artifacts.find((one) => one.path === path)?.content ?? ""
    expect(text("types.ts")).toContain("issues: IssueConnection")
    expect(text("API.md")).toContain(
      "| `issueDelete` | `mutation issueDelete` | `tracker api issue-delete` | destructive",
    )
    const { operations } = generated()
    const keys = Object.fromEntries(operations.map((one) => [one.id, one.permissions?.map((p) => p.key)]))
    expect(keys.issueDelete).toEqual(["issues.delete"])
    expect(keys.issueArchive).toEqual(["issues.delete"])
    expect(keys.issueUnarchive).toBeUndefined()
  })
})

describe("graphqlDocument and parseSelection", () => {
  const binding: GraphqlBinding = {
    kind: "graphql",
    operation: "query",
    field: "issue",
    variables: { id: "String!" },
    selection: "id",
  }

  it("declares and passes every variable around the selection", () => {
    expect(graphqlDocument(binding)).toBe("query Issue($id: String!) { issue(id: $id) { id } }")
    expect(graphqlDocument({ ...binding, variables: {} }, "")).toBe("query Issue { issue }")
  })

  it("reads names and braces, and refuses what it cannot check", () => {
    expect(parseSelection("id state { id type } ")).toEqual({ id: true, state: { id: true, type: true } })
    expect(() => parseSelection("id(first: 1)")).toThrow(/only field names/)
    expect(() => parseSelection("state { id")).toThrow(/not closed/)
    expect(() => parseSelection("state { }")).toThrow(/selects nothing/)
  })
})

describe("graphqlFake", () => {
  const KEY = "lin_api_fake"
  const post = (fake: ReturnType<typeof graphqlFake>, query: string, variables: unknown = {}, key = KEY) =>
    fake
      .fetch(URL_, {
        method: "POST",
        headers: { authorization: key, "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
      })
      .then(async (response) => ({ status: response.status, body: (await response.json()) as Record<string, unknown> }))
  const bindingOf = (operations: readonly ManifestOperation[], id: string) =>
    operations.find((one) => one.id === id)?.binding as GraphqlBinding
  const make = (answers = {}) => {
    const { operations, definitions } = generated()
    const fake = graphqlFake({
      operations,
      definitions,
      url: URL_,
      auth: { header: "Authorization", value: KEY },
      answers,
    })
    return { fake, operations }
  }

  it("answers a default selection with a sample within it", async () => {
    const { fake, operations } = make()
    const answer = await post(fake, graphqlDocument(bindingOf(operations, "issue")), { id: "a" })
    expect(answer.status).toBe(200)
    const issue = (answer.body.data as { issue: Record<string, unknown> }).issue
    expect(Object.keys(issue)).toContain("state")
    expect(issue.state).toEqual({ id: "xxxxxx" })
    expect(fake.refusals).toEqual([])
  })

  it("takes a deeper selection the types have, and refuses a field they lack", async () => {
    const { fake, operations } = make()
    const issues = bindingOf(operations, "issues")
    const deep = "nodes { id state { type } assignee { email } } pageInfo { hasNextPage endCursor }"
    expect((await post(fake, graphqlDocument(issues, deep))).status).toBe(200)
    const typo = await post(fake, graphqlDocument(issues, "nodes { id stat { type } } pageInfo { endCursor }"))
    expect(typo.status).toBe(400)
    expect(fake.refusals).toEqual(["issues.nodes.stat: no such field"])
  })

  it("refuses an object without a selection, wrong or unknown variables, a hand-typed document and no sign-in", async () => {
    const { fake, operations } = make()
    const issue = bindingOf(operations, "issue")
    await post(fake, graphqlDocument(issue, "id state"), { id: "a" })
    await post(fake, graphqlDocument(issue), { id: 7 })
    await post(fake, graphqlDocument(issue), { id: "a", extra: 1 })
    await post(fake, 'query { issue(id: "a") { id } }')
    await post(fake, graphqlDocument(issue), { id: "a" }, "wrong")
    expect(fake.refusals).toEqual([
      "issue.state: an object needs a selection",
      "variables.id: expected a string",
      "variables.extra: no such field",
      'no operation of the manifest builds the document: query { issue(id: "a") { id } }',
      "no Authorization header with the expected sign-in",
    ])
  })

  it("pages through a scenario with state, and sends errors[] with HTTP 200", async () => {
    const pages = [
      { nodes: [{ id: "1" }], pageInfo: { hasNextPage: true, endCursor: "c1" } },
      { nodes: [{ id: "2" }], pageInfo: { hasNextPage: false, endCursor: null } },
    ]
    const { fake, operations } = make({
      issues: ({ variables }: { variables: { after?: string } }) => ({ data: pages[variables.after === "c1" ? 1 : 0] }),
      issue: () => ({ errors: [{ message: "Entity not found", extensions: { code: "INVALID_INPUT" } }] }),
    })
    const issues = graphqlDocument(bindingOf(operations, "issues"), "nodes { id } pageInfo { hasNextPage endCursor }")
    const first = await post(fake, issues, { first: 1 })
    const second = await post(fake, issues, { first: 1, after: "c1" })
    expect([first.body.data, second.body.data]).toEqual([{ issues: pages[0] }, { issues: pages[1] }])
    const missing = await post(fake, graphqlDocument(bindingOf(operations, "issue")), { id: "x" })
    expect(missing).toEqual({
      status: 200,
      body: { data: null, errors: [{ message: "Entity not found", extensions: { code: "INVALID_INPUT" } }] },
    })
  })

  it("throws on a scenario that answers outside its selection", async () => {
    const { fake, operations } = make({ issue: () => ({ data: { id: "1", title: "x" } }) })
    await expect(post(fake, graphqlDocument(bindingOf(operations, "issue"), "id"), { id: "1" })).rejects.toThrow(
      /answer.title: not selected/,
    )
  })
})

describe("syncGraphql and readGraphql", () => {
  const dir = mkdtempSync(join(tmpdir(), "graphql-sync-"))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("writes the schema with its provenance, reads it back, and refuses a changed file", async () => {
    let asked: unknown
    const fetch = (async (_url: string, init: RequestInit) => {
      asked = JSON.parse(String(init.body))
      return new Response(JSON.stringify(trackerIntrospection()), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const provenance = await syncGraphql({ url: URL_, dir, fetch, now: new Date("2026-11-17T00:00:00Z") })
    expect(asked).toEqual({ query: INTROSPECTION_QUERY })
    expect(provenance).toMatchObject({ source: URL_, retrieved_at: "2026-11-17T00:00:00.000Z" })
    const read = readGraphql(dir)
    expect(adaptGraphql(read, { url: URL_, scalars }).operations).toHaveLength(10)
    writeFileSync(join(dir, "schema.json"), "{}")
    expect(() => readGraphql(dir)).toThrow(/hash mismatch/)
  })

  it("refuses an answer of errors, which a service sends when introspection needs a sign-in", async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ errors: [{ message: "auth" }] }))) as unknown as typeof globalThis.fetch
    await expect(syncGraphql({ url: URL_, dir, fetch })).rejects.toThrow(/may need a sign-in/)
  })
})
