import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adaptDiscovery, CodegenError, generate, manifestGenerator, readDiscovery, syncDiscovery } from "./index.js"

const drive = () => ({
  drive: {
    name: "drive",
    rootUrl: "https://www.googleapis.com/",
    servicePath: "drive/v3/",
    schemas: {
      File: { type: "object", properties: { size: { type: "string", format: "int64" }, self: { $ref: "File" } } },
    },
    resources: {
      files: {
        methods: {
          get: {
            id: "drive.files.get",
            path: "files/{fileId}",
            httpMethod: "GET",
            scopes: ["scope"],
            parameters: { fileId: { type: "string", location: "path", required: true } },
            response: { $ref: "File" },
          },
        },
      },
    },
  },
})

const method = (id: string, httpMethod: string, path: string) => ({
  id,
  httpMethod,
  path,
  scopes: ["https://www.googleapis.com/auth/calendar"],
  parameters: path.includes("{calendarId}") ? { calendarId: { type: "string", location: "path", required: true } } : {},
})

const calendar = () => ({
  calendar: {
    name: "calendar",
    rootUrl: "https://www.googleapis.com/",
    servicePath: "calendar/v3/",
    parameters: { key: { type: "string", location: "query" }, fields: { type: "string", location: "query" } },
    schemas: { Channel: { type: "object", properties: { id: { type: "string" } } } },
    resources: {
      calendars: { methods: { clear: method("calendar.calendars.clear", "POST", "calendars/{calendarId}/clear") } },
      freebusy: { methods: { query: method("calendar.freebusy.query", "POST", "freeBusy") } },
      events: {
        methods: {
          get: method("calendar.events.get", "GET", "calendars/{calendarId}/events/{eventId}"),
          watch: method("calendar.events.watch", "POST", "calendars/{calendarId}/events/watch"),
        },
      },
      channels: { methods: { stop: method("calendar.channels.stop", "POST", "channels/stop") } },
    },
  },
})

const webhooks = {
  "calendar.events.watch": "needs a public HTTPS endpoint a local CLI does not have",
  "calendar.channels.stop": "stops a watch channel, which this CLI never opens",
}

describe("adaptDiscovery", () => {
  it("makes provider documentation links absolute for generated Markdown consumers", () => {
    const source = drive()
    Object.assign(source.drive.resources.files.methods.get, {
      description: "See [search](/workspace/drive/api/guides/search-files).",
    })
    const { model } = adaptDiscovery(source)
    expect(model.operations[0]?.description).toContain(
      "https://developers.google.com/workspace/drive/api/guides/search-files",
    )
  })

  it("retains references, exact string IDs, required parameters and OAuth metadata", () => {
    const { model, metadata } = adaptDiscovery(drive())
    expect(model.operations[0]).toMatchObject({
      id: "drive.files.get",
      effect: "read",
      parameters: [{ name: "fileId", required: true }],
    })
    expect(metadata.scopes["drive.files.get"]).toEqual(["scope"])
    expect(model.schemas[0]?.schema).toMatchObject({
      properties: { size: { type: "string", pattern: "^-?\\d+$" }, self: { type: "ref", ref: "drive_File" } },
    })
  })

  it("refuses unknown constraints instead of silently weakening validation", () => {
    const source = drive()
    Object.assign(source.drive.schemas.File.properties.size, { inventedConstraint: true })
    expect(() => adaptDiscovery(source)).toThrow("unsupported schema keyword")
  })

  it("records where each service's paths are rooted, and the source it was given", () => {
    const { model, services } = adaptDiscovery(
      { ...drive(), ...calendar() },
      { sourceRevision: "spec/google/provenance.json" },
    )
    expect(services).toEqual({
      drive: { rootUrl: "https://www.googleapis.com/", servicePath: "drive/v3/" },
      calendar: { rootUrl: "https://www.googleapis.com/", servicePath: "calendar/v3/" },
    })
    expect(model.source).toEqual({
      kind: "other",
      sourceUrl: "https://developers.google.com/discovery",
      sourceRevision: "spec/google/provenance.json",
    })
  })

  it("leaves excluded methods out of the model and the scopes, and says why in the omissions", () => {
    const { model, metadata } = adaptDiscovery(calendar(), { exclude: webhooks })
    const ids = model.operations.map((operation) => operation.id)
    expect(ids).toEqual(["calendar.calendars.clear", "calendar.events.get", "calendar.freebusy.query"])
    expect(Object.keys(metadata.scopes)).not.toContain("calendar.events.watch")
    expect(metadata.omissions).toContain(
      "calendar.events.watch: excluded — needs a public HTTPS endpoint a local CLI does not have",
    )
  })

  it("stops on an exclusion that matches no method", () => {
    expect(() => adaptDiscovery(calendar(), { exclude: { "calendar.events.gone": "renamed" } })).toThrow(CodegenError)
  })

  it("drops transport parameters and keeps the document-wide ones", () => {
    const { model } = adaptDiscovery(calendar(), { exclude: webhooks })
    const get = model.operations.find((operation) => operation.id === "calendar.events.get")
    expect(get?.parameters.map((parameter) => parameter.name)).toEqual(["fields", "calendarId"])
  })

  it("lets generate's overrides correct the effects the HTTP verb misjudges", () => {
    const { model } = adaptDiscovery(calendar(), { exclude: webhooks })
    expect(model.operations.find((operation) => operation.id === "calendar.calendars.clear")?.effect).toBe("write")
    const [manifest] = generate(model, [manifestGenerator({ path: "manifest.ts" })], {
      banner: [],
      overrides: {
        "calendar.calendars.clear": { effect: "destructive", reason: "deletes every event of the primary calendar" },
        "calendar.freebusy.query": { effect: "read", reason: "a POST that only reads busy times" },
      },
    })
    expect(manifest?.content).toMatch(/"calendar\.calendars\.clear"[\s\S]*?"effect": "destructive"/)
    expect(manifest?.content).toMatch(/"calendar\.freebusy\.query"[\s\S]*?"effect": "read"/)
  })
})

describe("syncDiscovery and readDiscovery", () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), ".tmp-discovery-"))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const served = `{\n  "name": "calendar",\n  "revision": "20261021",\n  "version": "v3"\n}\n`
  const fetch = (async (url: string | URL | Request) => {
    expect(String(url)).toBe("https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest")
    return new Response(served)
  }) as typeof globalThis.fetch

  it("writes the served document and every provenance field, then reads them back verified", async () => {
    const sources = { calendar: "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest" }
    const hash = createHash("sha256").update(served).digest("hex")
    const provenance = await syncDiscovery(sources, { dir, fetch })
    expect(provenance).toEqual({
      calendar: {
        source: sources.calendar,
        revision: "20261021",
        version: "v3",
        sha256: hash,
        sourceSha256: hash,
        normalization: "object keys sorted, 2-space JSON; values and array order unchanged",
      },
    })
    expect(readFileSync(join(dir, "calendar.json"), "utf8")).toBe(served)
    expect(JSON.parse(readFileSync(join(dir, "provenance.json"), "utf8"))).toEqual(provenance)
    expect(readDiscovery(dir)).toEqual({ calendar: JSON.parse(served) })
  })

  it("refuses a snapshot edited after it was synced", () => {
    writeFileSync(join(dir, "calendar.json"), served.replace("v3", "v4"))
    expect(() => readDiscovery(dir)).toThrow("Discovery hash mismatch: calendar")
  })

  it("stops on a failed download and writes nothing", async () => {
    const failing = (async () => new Response("", { status: 503 })) as unknown as typeof globalThis.fetch
    const empty = mkdtempSync(join(dir, "empty-"))
    await expect(syncDiscovery({ calendar: "https://example.test" }, { dir: empty, fetch: failing })).rejects.toThrow(
      "HTTP 503",
    )
    expect(() => readFileSync(join(empty, "provenance.json"))).toThrow()
  })

  it("writes the same snapshot and model whatever order Google serves the keys in", async () => {
    const document = { ...calendar().calendar, labels: ["limited_availability", "beta"] }
    const reversed = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reversed)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, item]) => [key, reversed(item)]),
            )
          : value
    const sync = async (body: unknown) => {
      const target = mkdtempSync(join(dir, "order-"))
      const fetch = (async () => new Response(JSON.stringify(body))) as unknown as typeof globalThis.fetch
      const provenance = await syncDiscovery({ calendar: "https://example.test" }, { dir: target, fetch })
      return { target, provenance: provenance.calendar }
    }
    const a = await sync(document)
    const b = await sync(reversed(document))
    expect(readFileSync(join(a.target, "calendar.json"), "utf8")).toBe(
      readFileSync(join(b.target, "calendar.json"), "utf8"),
    )
    expect(a.provenance?.sha256).toBe(b.provenance?.sha256)
    expect(a.provenance?.sourceSha256).not.toBe(b.provenance?.sourceSha256)
    expect(adaptDiscovery(readDiscovery(a.target))).toEqual(adaptDiscovery(readDiscovery(b.target)))
    expect(JSON.parse(readFileSync(join(b.target, "calendar.json"), "utf8")).labels).toEqual(document.labels)
  })
})
