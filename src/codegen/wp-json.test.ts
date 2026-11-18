import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  type ApiOperation,
  adaptOpenApi,
  CodegenError,
  coverageGenerator,
  definitionsGenerator,
  fakeApi,
  generate,
  type ManifestOperation,
  manifestGenerator,
  type PermissionRule,
  readWpJson,
  type SchemaNode,
  syncWpJson,
  typesGenerator,
  valibotGenerator,
  wpJsonToOpenApi,
} from "./index.js"

// Cut from WordPress 6.9.4's own index on a plain install (GPL-2.0-or-later, see the LICENSE beside it).
const excerpt = (): { namespaces: string[]; routes: Record<string, Record<string, unknown>> } =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../../test/fixtures/wp-json/wp-json-excerpt.json"), "utf8"))

const POSTS = "/wp/v2/posts"
const POST = "/wp/v2/posts/(?P<id>[\\d]+)"
const TEMPLATE = Object.keys(excerpt().routes).find((route) => route.startsWith("/wp/v2/templates/")) as string

const problems = (run: () => unknown): string[] => {
  try {
    run()
  } catch (error) {
    if (error instanceof CodegenError) return [...error.problems]
    throw error
  }
  return []
}

const exported = (content: string | undefined, name: string): unknown => {
  const start = content?.indexOf(`export const ${name}`) ?? -1
  const text = content?.slice(content.indexOf("= ", start) + 2).split("\n\nexport ")[0] ?? ""
  return JSON.parse(text)
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("wpJsonToOpenApi", () => {
  const { document, omissions } = wpJsonToOpenApi(excerpt(), { namespaces: ["wp/v2"], site: "blog.example" })
  const model = adaptOpenApi(document)
  const operation = (id: string) => model.operations.find((one) => one.id === id)

  it("names each call by its method and path, and offers one write where WordPress takes POST, PUT and PATCH", () => {
    expect(model.operations.map((one) => one.id)).toEqual(
      expect.arrayContaining([
        "getWpV2Posts",
        "postWpV2Posts",
        "getWpV2PostsById",
        "postWpV2PostsById",
        "deleteWpV2PostsById",
        "postWpV2MediaByIdEdit",
        "getWpV2BlockTypesByNamespaceByName",
      ]),
    )
    expect(model.operations.some((one) => one.id.startsWith("putWpV2") || one.id.startsWith("patchWpV2"))).toBe(false)
    expect(omissions).toContain(`${POST}: PUT, PATCH left out, as POST does the same`)
    expect(operation("deleteWpV2PostsById")?.effect).toBe("destructive")
    expect(model.servers).toEqual([{ url: "https://{site}/wp-json", variables: { site: { default: "blog.example" } } }])
    expect(model.securitySchemes).toEqual({ applicationPassword: { type: "http", scheme: "basic" } })
  })

  it("leaves out other namespaces, the namespace's own index, and a route whose value may hold a slash", () => {
    expect(model.operations.some((one) => one.id.includes("Oembed"))).toBe(false)
    expect(omissions).toContain("oembed/1.0: not offered, 1 routes")
    expect(problems(() => wpJsonToOpenApi(excerpt(), { namespaces: ["wp/v2", "batch/v1"] }))).toEqual([
      "batch/v1 is never offered: a batch call runs other routes' writes past their own keys",
    ])
    expect(operation("getWpV2")).toBeUndefined()
    expect(model.operations.some((one) => one.id.includes("Templates"))).toBe(false)
    expect(omissions).toContain(`${TEMPLATE}: left out, as its value may hold a slash, which no path segment carries`)
  })

  it("puts a write's arguments in its body, a read's and a delete's in the query, and the route's groups in the path", () => {
    const create = operation("postWpV2Posts")
    expect(create?.parameters).toEqual([])
    expect(create?.requestBody?.schema).toMatchObject({
      type: "object",
      properties: { status: { type: "string", enum: ["publish", "future", "draft", "pending", "private"] } },
    })
    const remove = operation("deleteWpV2PostsById")
    expect(remove?.parameters.map((one) => [one.in, one.name])).toEqual([
      ["path", "id"],
      ["query", "force"],
    ])
    expect(operation("postWpV2PostsById")?.parameters).toMatchObject([{ in: "path", name: "id", required: true }])
  })

  it("sends a list in the query as one comma-separated value, which WordPress splits and PHP does not repeat", () => {
    const include = operation("getWpV2Posts")?.parameters.find((one) => one.name === "include")
    expect(include?.schema).toMatchObject({ type: "string" })
    expect(include?.schema.description).toContain("comma-separated")
  })

  it("answers a collection read with a list of the route's schema and an item read with one", () => {
    expect(operation("getWpV2Posts")?.response?.schema).toEqual({ type: "array", items: { type: "ref", ref: "post" } })
    expect(operation("getWpV2PostsById")?.response?.schema).toEqual({ type: "ref", ref: "post" })
    expect(operation("deleteWpV2PostsById")?.response?.schema).toBeUndefined()
  })

  it("reads WordPress's draft 4: required in both spellings, bool, an untyped object and free keys by pattern", () => {
    const edit = operation("postWpV2MediaByIdEdit")?.requestBody?.schema
    expect(JSON.stringify(edit)).toContain(
      '"required":["flip"]},"type":{"description":"Flip type.","type":"string","enum":["flip"]}},"required":["type","args"]}',
    )
    const blockType = model.schemas.find((one) => one.id === "block_type")?.schema as {
      properties: Record<string, SchemaNode>
    }
    expect(blockType.properties.block_hooks).toMatchObject({
      type: "object",
      additionalProperties: { type: "string", enum: ["before", "after", "first_child", "last_child"] },
    })
    expect(JSON.stringify(model)).not.toContain('"bool"')
  })

  it("stops on a route it cannot read, a second route on one path, an untyped argument and a stale exclusion", () => {
    const index = excerpt()
    index.routes["/wp/v2/odd(?:x)"] = { namespace: "wp/v2", methods: ["GET"], endpoints: [] }
    index.routes["/wp/v2/posts/(?P<id>[0-9]+)"] = { namespace: "wp/v2", methods: ["GET"], endpoints: [] }
    index.routes["/wp/v2/unclosed/(?P<id>[\\d]+"] = { namespace: "wp/v2", methods: ["GET"], endpoints: [] }
    index.routes["/wp/v2/digits/(?P<id>[\\/\\d]+)"] = { namespace: "wp/v2", methods: ["GET"], endpoints: [] }
    index.routes["/wp/v2/untyped"] = {
      namespace: "wp/v2",
      methods: ["GET"],
      endpoints: [{ methods: ["GET"], args: { anything: { default: 1 } } }],
    }
    expect(problems(() => wpJsonToOpenApi(index, { namespaces: ["wp/v2"], exclude: { "/wp/v2/gone": "r" } }))).toEqual([
      "/wp/v2/odd(?:x): the route is a pattern no path template expresses; exclude it with a reason",
      "/wp/v2/posts/(?P<id>[0-9]+): a second route on /wp/v2/posts/{id}; exclude one with a reason",
      "/wp/v2/unclosed/(?P<id>[\\d]+: the route is a pattern no path template expresses; exclude it with a reason",
      "/wp/v2/untyped GET anything: no type",
      'exclusion "/wp/v2/gone" matches no route — stale, or the route changed',
    ])
    const excluded = wpJsonToOpenApi(index, {
      namespaces: ["wp/v2"],
      exclude: {
        "/wp/v2/odd(?:x)": "test",
        "/wp/v2/posts/(?P<id>[0-9]+)": "test",
        "/wp/v2/untyped": "test",
        "/wp/v2/unclosed/(?P<id>[\\d]+": "test",
      },
    })
    expect(excluded.omissions).toContain(
      "/wp/v2/digits/(?P<id>[\\/\\d]+): left out, as its value may hold a slash, which no path segment carries",
    )
    expect(excluded.omissions).toContain("/wp/v2/untyped: excluded — test")
    expect(problems(() => wpJsonToOpenApi({}, { namespaces: ["wp/v2"] }))).toEqual([
      "not a WordPress REST index: no routes",
    ])
  })
})

describe("the api group of a WordPress CLI from its snapshot", () => {
  const converted = wpJsonToOpenApi(excerpt(), { namespaces: ["wp/v2"] })
  const model = adaptOpenApi(converted.document)
  const group = (one: ApiOperation) => (one.binding.kind === "http" ? (one.binding.path.split("/")[3] ?? "wp") : "wp")
  const build = (valueKeys: NonNullable<PermissionRule["valueKeys"]>, rule: Pick<PermissionRule, "forceFlags"> = {}) =>
    generate(
      model,
      [
        manifestGenerator({ path: "manifest.ts" }),
        definitionsGenerator({ path: "definitions.ts" }),
        coverageGenerator({ path: "API.md", title: "API", command: (one) => one.command }),
        typesGenerator({ path: "types.ts" }),
        valibotGenerator({ path: "schemas.ts", typesImport: "./types.js" }),
      ],
      { banner: [], overrides: converted.overrides, permissions: { group, valueKeys, ...rule } },
    )
  const [manifest, definitions, coverage] = build([{ key: "publish", field: "status", values: ["publish", "future"] }])
  const operations = exported(manifest?.content, "operations") as ManifestOperation[]
  const permissionsOf = (id: string) => operations.find((one) => one.id === id)?.permissions

  it("needs posts.publish to create or change a post with status publish or future, pages.publish for a page", () => {
    expect(permissionsOf("postWpV2Posts")).toEqual([
      { key: "posts.publish", values: { status: ["publish", "future"] } },
    ])
    expect(permissionsOf("postWpV2PostsById")).toEqual([
      { key: "posts.publish", values: { status: ["publish", "future"] } },
    ])
    expect(permissionsOf("postWpV2Pages")).toEqual([
      { key: "pages.publish", values: { status: ["publish", "future"] } },
    ])
    expect(coverage?.content).toContain("| `postWpV2Posts` | `posts.publish` | `status` is publish or future |")
  })

  it("needs the key on every call where leaving the field out publishes, as a menu item's status defaults to publish", () => {
    expect(permissionsOf("postWpV2MenuItems")).toEqual([{ key: "menu-items.publish" }])
    expect(coverage?.content).toContain("| `postWpV2MenuItems` | `menu-items.publish` | always |")
  })

  it("finds the values through a reference or a union, and leaves a read that filters by them alone", () => {
    const status: SchemaNode = { type: "string", enum: ["publish", "draft"] }
    const operationWith = (id: string, effect: "read" | "write", schema: SchemaNode): ApiOperation => ({
      id,
      binding: { kind: "http", method: effect === "read" ? "GET" : "POST", path: `/${id}` },
      effect,
      tags: [],
      parameters: effect === "read" ? [{ name: "status", in: "query", required: false, schema }] : [],
      ...(effect === "write"
        ? {
            requestBody: {
              confidence: "contract" as const,
              required: true,
              schema: { type: "object" as const, properties: { status: schema }, required: [] },
            },
          }
        : {}),
      source: { location: id },
    })
    const small = {
      source: { kind: "openapi" as const },
      schemas: [{ id: "Status", schema: status }],
      operations: [
        operationWith("byUnion", "write", { type: "union", of: [{ type: "integer" }, status] }),
        operationWith("byRef", "write", { type: "ref", ref: "Status" }),
        operationWith("filter", "read", status),
      ],
    }
    const [built] = generate(small, [manifestGenerator({ path: "manifest.ts" })], {
      banner: [],
      permissions: { group: "posts", valueKeys: [{ key: "publish", field: "status", values: ["publish"] }] },
    })
    const listed = exported(built?.content, "operations") as ManifestOperation[]
    const keys = Object.fromEntries(listed.map((one) => [one.id, one.permissions]))
    expect(keys).toEqual({
      byUnion: [{ key: "posts.publish", values: { status: ["publish"] } }],
      byRef: [{ key: "posts.publish", values: { status: ["publish"] } }],
      filter: undefined,
    })
  })

  it("gives no publish key to a field of that name that lists no such value, as a comment's status", () => {
    expect(permissionsOf("postWpV2Comments")).toBeUndefined()
    expect(permissionsOf("deleteWpV2PostsById")).toEqual([{ key: "posts.delete" }])
    expect(problems(() => build([{ key: "publish", field: "status", values: ["published"] }]))).toEqual([
      'valueKeys: no write lists published in the enum of "status"',
    ])
  })

  it("needs posts.publish to set a post's date unless the call itself keeps it a draft, pending or private", () => {
    const [dated] = build([
      { key: "publish", field: "status", values: ["publish", "future"], also: ["date", "date_gmt"] },
    ])
    const listed = exported(dated?.content, "operations") as ManifestOperation[]
    const keyOf = (id: string) => listed.find((one) => one.id === id)?.permissions
    expect(keyOf("postWpV2PostsById")).toEqual([
      {
        key: "posts.publish",
        values: { status: ["publish", "future"] },
        body: ["date", "date_gmt"],
        unless: { status: ["draft", "pending", "private"] },
      },
    ])
    expect(keyOf("postWpV2MenuItems")).toEqual([{ key: "menu-items.publish" }])
  })

  it("needs a delete.force key besides delete when force=true deletes for good instead of moving to the trash", () => {
    const [forced, , listing] = build([{ key: "publish", field: "status", values: ["publish", "future"] }], {
      forceFlags: ["force"],
    })
    const listed = exported(forced?.content, "operations") as ManifestOperation[]
    expect(listed.find((one) => one.id === "deleteWpV2PostsById")?.permissions).toEqual([
      { key: "posts.delete" },
      { key: "posts.delete.force", query: ["force"] },
    ])
    expect(listing?.content).toContain("| `deleteWpV2PostsById` | `posts.delete.force` | query `force` is true |")
    expect(
      problems(() =>
        build([{ key: "publish", field: "status", values: ["publish", "future"], also: ["dat"] }], {
          forceFlags: ["force"],
        }),
      ),
    ).toEqual(['valueKeys: also "dat" is in no write that "publish" guards'])
    expect(problems(() => build([], { forceFlags: ["purge"] }))).toEqual([
      'forceFlags: "purge" is in no delete\'s request body or query',
    ])
  })

  it("pages a collection read from 1 by the X-WP-TotalPages header, the answer itself being the list", () => {
    const read = operations.find((one) => one.id === "getWpV2Posts")
    expect(read?.pagination).toEqual({
      style: "page",
      page: { in: "query", name: "page" },
      limit: { in: "query", name: "per_page" },
      items: "",
      start: 1,
      pagesHeader: "x-wp-totalpages",
    })
  })

  it("serves the generated calls from a fake that checks the application password", async () => {
    const fake = fakeApi({
      operations,
      definitions: exported(definitions?.content, "definitions") as Record<string, SchemaNode>,
      baseUrl: "https://blog.example/wp-json",
      ...(model.securitySchemes ? { securitySchemes: model.securitySchemes } : {}),
      ...(model.security ? { security: model.security } : {}),
      token: "editor:abcd efgh",
    })
    const authorization = `Basic ${Buffer.from("editor:abcd efgh").toString("base64")}`
    const posts = await fake.fetch("https://blog.example/wp-json/wp/v2/posts?per_page=2", {
      headers: { authorization },
    })
    expect(posts.status).toBe(200)
    expect(Array.isArray(await posts.json())).toBe(true)
    const wrong = await fake.fetch("https://blog.example/wp-json/wp/v2/posts", {
      headers: { authorization: `Basic ${Buffer.from("editor:nope").toString("base64")}` },
    })
    expect(wrong.status).toBe(401)
  })
})

describe("syncWpJson and readWpJson", () => {
  it("keeps only the API, not the site or a password in its address, and refuses a snapshot changed by hand", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wp-json-"))
    roots.push(dir)
    const site = {
      name: "Owner's blog",
      url: "https://owner.example",
      namespaces: ["wp/v2"],
      routes: {
        [POSTS]: {
          namespace: "wp/v2",
          methods: ["GET"],
          endpoints: [{ methods: ["GET"], args: {} }],
          schema: { title: "post", type: "object", properties: {}, links: [{ href: "https://owner.example/x" }] },
          _links: { self: [{ href: "https://owner.example/wp-json/wp/v2/posts" }] },
        },
      },
    }
    const asked: string[] = []
    const fetch = (async (input: string | URL) => {
      asked.push(String(input))
      return Response.json(site)
    }) as typeof globalThis.fetch
    const provenance = await syncWpJson({
      root: "https://editor:secret@owner.example/wp-json/",
      dir,
      version: "6.9.4",
      fetch,
      now: new Date("2026-11-18T00:00:00Z"),
    })
    expect(asked).toEqual(["https://owner.example/wp-json/?context=help"])
    expect(provenance).toMatchObject({
      source: "https://owner.example/wp-json/?context=help",
      version: "6.9.4",
      retrieved_at: "2026-11-18T00:00:00.000Z",
    })
    expect(readFileSync(join(dir, "provenance.json"), "utf8")).not.toContain("secret")
    const written = readFileSync(join(dir, "wp-json.json"), "utf8")
    expect(written).not.toContain("owner")
    expect(readWpJson(dir)).toEqual({
      namespaces: ["wp/v2"],
      routes: {
        [POSTS]: {
          endpoints: [{ args: {}, methods: ["GET"] }],
          methods: ["GET"],
          namespace: "wp/v2",
          schema: { properties: {}, title: "post", type: "object" },
        },
      },
    })
    writeFileSync(join(dir, "wp-json.json"), written.replace('"GET"', '"POST"'))
    expect(problems(() => readWpJson(dir))).toEqual([`WordPress index hash mismatch: ${join(dir, "wp-json.json")}`])
  })

  it("names a site that does not answer an index", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wp-json-"))
    roots.push(dir)
    const answer = (body: unknown, status = 200) =>
      (async () => Response.json(body, { status })) as unknown as typeof globalThis.fetch
    await expect(
      syncWpJson({ root: "https://x.example/wp-json/", dir, version: "6", fetch: answer({}, 404) }),
    ).rejects.toThrow("WordPress index fetch failed: HTTP 404")
    await expect(
      syncWpJson({ root: "https://x.example/wp-json/", dir, version: "6", fetch: answer({}) }),
    ).rejects.toThrow("https://x.example/wp-json/ is not a WordPress REST index")
  })
})
