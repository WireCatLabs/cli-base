/**
 * Finds how a read pages from the names its request and answer use: a cursor (`after` → `paging.next.after`,
 * `start_cursor` → `next_cursor`), an offset (`offset` with `_embedded.items`), a page number, or a link to the next
 * page. A name it does not know detects nothing; an override then says how the operation pages.
 */
import type { ApiOperation, ApiSchema, PageParameter, Pagination, SchemaNode } from "./model.js"

const CURSORS = ["after", "cursor", "start_cursor", "page_token", "pageToken", "starting_after", "continuation"]
// Not `cursor`: an answer that echoes the request's cursor back would read as the next one.
const NEXT_CURSORS = ["next_cursor", "nextCursor", "next_page_token", "nextPageToken", "next_page_cursor"]
const LIMITS = ["limit", "page_size", "pageSize", "per_page", "perPage", "count", "max_results", "maxResults"]
const ITEMS = ["results", "items", "data", "entries", "records", "values"]
// Not `count`: as often the number of items on this page, after which an executor would stop.
const TOTALS = ["total", "total_count", "totalCount"]
const LINKS = ["next", "links.next", "_links.next.href", "paging.next.link", "next_url", "nextUrl"]
const DEPTH = 3

type Field = { path: string; node: SchemaNode }
type Typed = PageParameter & { type: SchemaNode["type"] }

/** Every field of an answer down to `DEPTH`, through references and inheritance; a union's members are not guessed. */
const fieldsOf = (root: SchemaNode, schemas: ReadonlyMap<string, ApiSchema>): Field[] => {
  const found: Field[] = []
  const walk = (node: SchemaNode, prefix: string, depth: number, seen: ReadonlySet<string>): void => {
    if (node.type === "ref") {
      const target = schemas.get(node.ref)
      if (target && !seen.has(node.ref)) walk(target.schema, prefix, depth, new Set([...seen, node.ref]))
      return
    }
    if (node.type === "allOf") {
      for (const member of node.of) walk(member, prefix, depth, seen)
      return
    }
    if (node.type !== "object" || depth === DEPTH) return
    for (const [name, property] of Object.entries(node.properties)) {
      const path = prefix ? `${prefix}.${name}` : name
      found.push({ path, node: property })
      walk(property, path, depth + 1, seen)
    }
  }
  walk(root, "", 0, new Set())
  return found
}

const resolve = (node: SchemaNode, schemas: ReadonlyMap<string, ApiSchema>): SchemaNode => {
  for (let at = node, hops = 0; hops < 10; hops++) {
    if (at.type !== "ref") return at
    const target = schemas.get(at.ref)
    if (!target) return at
    at = target.schema
  }
  return node
}

const lastName = (path: string) => path.slice(path.lastIndexOf(".") + 1)

export const requestParameters = (operation: ApiOperation, schemas: ReadonlyMap<string, ApiSchema>): Typed[] => [
  ...operation.parameters
    .filter((parameter) => parameter.in === "query")
    .map((parameter) => ({
      in: "query" as const,
      name: parameter.name,
      type: resolve(parameter.schema, schemas).type,
    })),
  ...(operation.requestBody?.schema
    ? fieldsOf(operation.requestBody.schema, schemas)
        .filter((field) => !field.path.includes("."))
        .map((field) => ({ in: "body" as const, name: field.path, type: resolve(field.node, schemas).type }))
    : []),
]

/** The answer's fields as dotted paths, for an override's check. */
export const answerPaths = (operation: ApiOperation, schemas: ReadonlyMap<string, ApiSchema>): Set<string> =>
  new Set(operation.response?.schema ? fieldsOf(operation.response.schema, schemas).map((field) => field.path) : [])

export const detectPagination = (
  operation: ApiOperation,
  schemas: ReadonlyMap<string, ApiSchema>,
): Pagination | undefined => {
  if (operation.effect !== "read" || !operation.response?.schema) return undefined
  const answer = fieldsOf(operation.response.schema, schemas)
  const typed = (path: string) => answer.find((field) => field.path === path)
  const kind = (field: Field) => resolve(field.node, schemas).type
  const request = requestParameters(operation, schemas)
  // A `start` date or a `page` id is not a position: only a number counts as an offset, a page or a limit.
  const named = (names: readonly string[], types: readonly string[]): PageParameter | undefined => {
    const found = names
      .map((name) => request.find((parameter) => parameter.name === name && types.includes(parameter.type)))
      .find(Boolean)
    return found && { in: found.in, name: found.name }
  }
  const NUMBER = ["integer", "number"]
  const limit = named(LIMITS, NUMBER)
  const optional = <K extends string, V>(key: K, value: V | undefined) =>
    (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>

  const arrays = answer.filter((field) => kind(field) === "array")
  const items =
    ITEMS.map((name) => arrays.find((field) => lastName(field.path) === name)).find(Boolean) ??
    (arrays.length === 1 && !arrays[0]?.path.includes(".") ? arrays[0] : undefined)
  const sibling = (names: readonly string[]) => {
    const parent = items?.path.includes(".") ? items.path.slice(0, items.path.lastIndexOf(".") + 1) : ""
    return names
      .map((name) => typed(`${parent}${name}`))
      .find((field) => field !== undefined && ["integer", "number"].includes(kind(field)))?.path
  }

  const cursor = named(CURSORS, ["string"])
  if (cursor) {
    const strings = answer.filter((field) => kind(field) === "string")
    const next =
      strings.find((field) => field.path.endsWith(`next.${cursor.name}`)) ??
      NEXT_CURSORS.map((name) => strings.find((field) => lastName(field.path) === name)).find(Boolean)
    if (next) {
      const hasMore = answer.find(
        (field) => ["has_more", "hasMore"].includes(lastName(field.path)) && kind(field) === "boolean",
      )
      return {
        style: "cursor",
        cursor,
        next: next.path,
        ...optional("items", items?.path),
        ...optional("hasMore", hasMore?.path),
        ...optional("limit", limit),
      }
    }
  }
  const offset = named(["offset", "skip", "start"], NUMBER)
  if (offset && items)
    return {
      style: "offset",
      offset,
      ...optional("limit", limit),
      items: items.path,
      ...optional("total", sibling(TOTALS)),
    }
  const page = named(["page", "page_number", "pageNumber"], NUMBER)
  if (page && items)
    return {
      style: "page",
      page,
      ...optional("limit", limit),
      items: items.path,
      ...optional("total", sibling(TOTALS)),
    }
  const link = LINKS.map((path) => typed(path)).find((field) => field !== undefined && kind(field) === "string")
  if (link) return { style: "link", next: link.path, ...optional("items", items?.path) }
  return undefined
}
