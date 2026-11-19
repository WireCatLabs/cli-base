import { describe, expect, it } from "vitest"
import { adaptOpenApi, apiCommandPath, applyNames, type CommandNames, generate, manifestGenerator } from "./index.js"

type Paths = Record<string, Record<string, { operationId: string; tags?: string[] }>>

const spec = (paths: Paths) => adaptOpenApi({ openapi: "3.1.0", info: {}, paths, components: { schemas: {} } })

const paths = (model: ReturnType<typeof spec>) =>
  model.operations.map((operation) =>
    apiCommandPath({ command: operation.command ?? operation.id, group: operation.group }).join(" "),
  )

const crm: Paths = {
  "/contacts": {
    get: { operationId: "contacts-list", tags: ["Contacts"] },
    post: { operationId: "contacts-create", tags: ["Contacts", "Batch"] },
  },
  "/pages/move": { post: { operationId: "move-page", tags: ["Pages"] } },
  "/pages": { get: { operationId: "pages-list", tags: ["Pages"] } },
  "/search": { post: { operationId: "search", tags: ["Search"] } },
  "/me": { get: { operationId: "me" } },
}

describe("api subgroups", () => {
  it("groups by the first tag, cuts the repeated prefix, and keeps a lone or untagged operation flat", () => {
    const model = applyNames(spec(crm), { groups: "tags" })
    expect(paths(model)).toEqual(["contacts list", "contacts create", "pages move-page", "pages list", "search", "me"])
    expect(model.operations.find(({ id }) => id === "search")?.group).toBeUndefined()
  })

  it("groups by the first word of the command where the tags name no resource, and renames a group", () => {
    const hubspot: Paths = {
      "/contacts": {
        get: { operationId: "contacts-list", tags: ["Basic"] },
        post: { operationId: "contacts-batch-create", tags: ["Batch"] },
      },
      "/deals": { get: { operationId: "deals-list", tags: ["Basic"] }, post: { operationId: "deals-create" } },
    }
    const names: CommandNames = { groups: "first-word", groupNames: { deals: "opportunities" } }
    expect(paths(applyNames(spec(hubspot), names))).toEqual([
      "contacts list",
      "contacts batch-create",
      "opportunities deals-list",
      "opportunities deals-create",
    ])
    expect(paths(applyNames(spec(hubspot), { groups: "first-word", groupNames: { deals: "" } }))).toEqual([
      "contacts list",
      "contacts batch-create",
      "deals-list",
      "deals-create",
    ])
  })

  it("writes the group into the manifest, and leaves a manifest without `groups` as it was", () => {
    const manifestOf = (names: CommandNames) =>
      generate(spec(crm), [manifestGenerator({ path: "manifest.ts" })], { banner: [], names })[0]?.content ?? ""
    expect(manifestOf({ groups: "tags" })).toContain('"group": "contacts"')
    expect(manifestOf({})).not.toContain('"group"')
  })

  it("refuses a group named like api's own command or like a command, two commands on one path, and a stale name", () => {
    const run =
      (more: Paths, names: CommandNames = { groups: "tags" }) =>
      () =>
        applyNames(spec({ ...crm, ...more }), names)
    expect(
      run({ "/a": { get: { operationId: "a", tags: ["List"] } }, "/b": { get: { operationId: "b", tags: ["List"] } } }),
    ).toThrow('group "list" is api\'s own command')
    expect(run({ "/c": { get: { operationId: "contacts", tags: ["Contacts"] } } })).toThrow(
      'group "contacts" is also the command "contacts"',
    )
    expect(run({ "/l": { get: { operationId: "list", tags: ["Contacts"] } } })).toThrow(
      '"contacts-list" and "list" are both api contacts list',
    )
    expect(run({}, { groups: "tags", groupNames: { Nope: "x" } })).toThrow('group "Nope" is no tag')
    expect(run({}, { groups: "tags", groupNames: { Pages: "Big Pages" } })).toThrow('group "Big Pages" is not kebab')
  })
})
