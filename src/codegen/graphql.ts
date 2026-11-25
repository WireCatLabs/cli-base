/**
 * A GraphQL schema's introspection result, already parsed → the format-neutral `ApiModel`, plus the offline snapshot
 * it comes from: `syncGraphql` asks the endpoint for its schema with the standard introspection query and records
 * where it came from, and `readGraphql` loads it back only while its hash still matches.
 *
 * One field of `Query` or `Mutation` is one operation. Its arguments are the request body (the variables), each also a
 * flag; its answer is `data.<field>`, typed by the field's type. A query reads; a mutation writes, and one whose name
 * ends in `Delete` or `Archive` deletes. A Relay connection pages as a `cursor`: `after`, `pageInfo.endCursor`.
 * Its first tag is the entity its name acts on (`issueLabelCreate` → `issue-label`), its second `query` or `mutation`:
 * the agent skill files one page per first tag, and an agent looking for an issue's writes reads only the issue page.
 * SDL is not read: that needs graphql-js, and codegen adds no runtime dependency.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ApiModel, ApiOperation, ApiSchema, GraphqlBinding, Pagination, SchemaNode } from "./model.js"
import { kebab } from "./names.js"
import { CodegenError } from "./pipeline.js"
import { sha256, sortKeys } from "./snapshot.js"

type Json = Record<string, unknown>

interface TypeRef {
  kind: string
  name?: string | null
  ofType?: TypeRef | null
}

interface InputValue {
  name: string
  description?: string | null
  type: TypeRef
  defaultValue?: string | null
}

interface Field {
  name: string
  description?: string | null
  args: InputValue[]
  type: TypeRef
  isDeprecated?: boolean
}

interface FullType {
  kind: string
  name: string
  description?: string | null
  fields?: Field[] | null
  inputFields?: InputValue[] | null
  enumValues?: { name: string }[] | null
  possibleTypes?: { name: string }[] | null
}

const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value)

const BUILT_IN: Readonly<Record<string, SchemaNode>> = {
  String: { type: "string" },
  ID: { type: "string" },
  Int: { type: "integer", format: "int32" },
  Float: { type: "number" },
  Boolean: { type: "boolean" },
}

export interface GraphqlOptions {
  /** The endpoint every operation is sent to: `https://api.linear.app/graphql`. */
  url: string
  /**
   * The schema's own scalars, each as the JSON value it travels as: `{ DateTime: { type: "string" }, JSON: { type:
   * "unknown" } }`. A scalar the schema uses that is not here stops generation: its shape is never guessed.
   */
  scalars?: Readonly<Record<string, SchemaNode>>
  /**
   * Fields of `Query` or `Mutation` left out, each with the reason: by name, or as `query.<name>` or `mutation.<name>`
   * when both roots have one of that name. One that matches no field stops generation.
   */
  exclude?: Readonly<Record<string, string>>
  sourceUrl?: string
  sourceRevision?: string
}

const DELETES = /(Delete|Archive)$/
const UNDOES = /Unarchive$/
export const GRAPHQL_DELETE_REASON = "a mutation whose name ends in Delete or Archive deletes"

/** `[ID!]!` from its introspection reference. */
const typeText = (ref: TypeRef): string =>
  ref.kind === "NON_NULL" && ref.ofType
    ? `${typeText(ref.ofType)}!`
    : ref.kind === "LIST" && ref.ofType
      ? `[${typeText(ref.ofType)}]`
      : String(ref.name)

const named = (ref: TypeRef): string => (ref.ofType ? named(ref.ofType) : String(ref.name))

const schemaOf = (raw: unknown): Json => {
  const root = object(raw) && object(raw.data) ? raw.data : raw
  if (!object(root) || !object(root.__schema))
    throw new CodegenError(["not a GraphQL introspection result: no __schema"])
  return root.__schema
}

export const adaptGraphql = (introspection: unknown, options: GraphqlOptions): ApiModel => {
  const schema = schemaOf(introspection)
  const types = new Map<string, FullType>()
  for (const type of Array.isArray(schema.types) ? (schema.types as FullType[]) : [])
    if (object(type) && typeof type.name === "string" && !type.name.startsWith("__")) types.set(type.name, type)
  const rootName = (key: string) => {
    const root = schema[key]
    return object(root) && typeof root.name === "string" ? root.name : undefined
  }
  const scalars = { ...BUILT_IN, ...options.scalars }
  const unknownScalars = [...types.values()]
    .filter((type) => type.kind === "SCALAR" && !scalars[type.name])
    .map((type) => `scalar ${type.name}: map it in scalars, as the JSON value it travels as`)
  if (unknownScalars.length > 0) throw new CodegenError(unknownScalars)

  const described = (text: string | null | undefined) => (text ? { description: text } : {})
  const reference = (ref: TypeRef, where: string): SchemaNode => {
    if (ref.kind === "NON_NULL" && ref.ofType) {
      const { nullable: _, ...inner } = reference(ref.ofType, where) as SchemaNode & { nullable?: boolean }
      return inner as SchemaNode
    }
    if (ref.kind === "LIST" && ref.ofType) return { type: "array", items: reference(ref.ofType, where), nullable: true }
    const name = String(ref.name)
    const type = types.get(name)
    if (!type) throw new CodegenError([`${where}: the schema has no type ${name}`])
    if (type.kind === "SCALAR") return { ...(scalars[name] as SchemaNode), nullable: true }
    return { type: "ref", ref: name, nullable: true }
  }

  const schemas: ApiSchema[] = []
  for (const type of types.values()) {
    const where = `type ${type.name}`
    const common = described(type.description)
    switch (type.kind) {
      case "SCALAR":
        break
      case "ENUM":
        schemas.push({
          id: type.name,
          schema: { ...common, type: "string", enum: (type.enumValues ?? []).map((one) => one.name) },
        })
        break
      case "OBJECT":
      case "INTERFACE":
        // A selection asks for some of the fields, so none is required in an answer.
        schemas.push({
          id: type.name,
          schema: {
            ...common,
            type: "object",
            properties: Object.fromEntries(
              (type.fields ?? []).map((field) => [
                field.name,
                { ...reference(field.type, `${where}.${field.name}`), ...described(field.description) },
              ]),
            ),
            required: [],
          },
        })
        break
      case "UNION":
        schemas.push({
          id: type.name,
          schema: {
            ...common,
            type: "union",
            of: (type.possibleTypes ?? []).map((one) => ({ type: "ref", ref: one.name })),
          },
        })
        break
      case "INPUT_OBJECT":
        schemas.push({ id: type.name, schema: { ...common, ...inputObject(type.inputFields ?? [], where) } })
        break
      default:
        throw new CodegenError([`${where}: unsupported kind ${type.kind}`])
    }
  }

  function inputObject(values: readonly InputValue[], where: string): SchemaNode {
    return {
      type: "object",
      properties: Object.fromEntries(
        values.map((one) => [
          one.name,
          { ...reference(one.type, `${where}.${one.name}`), ...described(one.description) },
        ]),
      ),
      required: values.filter((one) => one.type.kind === "NON_NULL" && one.defaultValue == null).map((one) => one.name),
    }
  }

  const fieldsOf = (name: string) => {
    const type = types.get(name)
    return type && (type.kind === "OBJECT" || type.kind === "INTERFACE") ? (type.fields ?? []) : undefined
  }
  const selectable = (field: Field) =>
    !field.isDeprecated && !field.args.some((one) => one.type.kind === "NON_NULL" && one.defaultValue == null)
  const isLeaf = (name: string) => {
    const kind = types.get(name)?.kind
    return kind === "SCALAR" || kind === "ENUM"
  }
  /** Scalars, and `{ id }` of each object that has one; a type with neither gives `__typename`. */
  const oneLevel = (name: string): string => {
    const parts = (fieldsOf(name) ?? []).filter(selectable).flatMap((field) => {
      const inner = named(field.type)
      if (isLeaf(inner)) return [field.name]
      return fieldsOf(inner)?.some((one) => one.name === "id") ? [`${field.name} { id }`] : []
    })
    return parts.length > 0 ? parts.join(" ") : "__typename"
  }
  /** A Relay connection: `nodes` of one type, and a `pageInfo` with `hasNextPage` and `endCursor`. */
  const connectionOf = (name: string): string | undefined => {
    const fields = fieldsOf(name)
    const nodes = fields?.find((one) => one.name === "nodes")
    const pageInfo = fields?.find((one) => one.name === "pageInfo")
    const info = pageInfo && fieldsOf(named(pageInfo.type))
    if (!nodes || !info || !["hasNextPage", "endCursor"].every((key) => info.some((one) => one.name === key)))
      return undefined
    return named(nodes.type)
  }
  const selectionOf = (name: string): string => {
    if (isLeaf(name)) return ""
    if (types.get(name)?.kind === "UNION") return "__typename"
    const node = connectionOf(name)
    return node ? `nodes { ${oneLevel(node)} } pageInfo { hasNextPage endCursor }` : oneLevel(name)
  }

  const entities = new Map(
    [...types.values()]
      .filter((type) => fieldsOf(type.name)?.some((one) => one.name === "id"))
      .map((type) => [type.name.toLowerCase(), type.name]),
  )
  const singulars = (word: string) => [
    word,
    ...(word.endsWith("ies") ? [`${word.slice(0, -3)}y`] : []),
    ...(word.endsWith("es") ? [word.slice(0, -2)] : []),
    ...(word.endsWith("s") ? [word.slice(0, -1)] : []),
  ]
  /**
   * The earliest, then longest, run of the name's words that names an object with an id, its last word read singular
   * too: `issueLabels` → `issue-label`, `searchIssues` → `issue`. A mutation's whole name is never its entity, as
   * `projectUpdate` changes a project while the type `ProjectUpdate` is a status post. None: the name's first word.
   */
  const entityOf = (name: string, operation: "query" | "mutation"): string => {
    const words = name
      .split(/_+|(?=[A-Z])/)
      .filter(Boolean)
      .map((word) => word.toLowerCase())
    for (let start = 0; start < words.length; start++)
      for (let end = words.length; end > start; end--) {
        if (operation === "mutation" && start === 0 && end === words.length) continue
        const head = words.slice(start, end - 1).join("")
        const found = singulars(words[end - 1] ?? "")
          .map((last) => entities.get(head + last))
          .find(Boolean)
        if (found) return kebab(found)
      }
    return kebab(name).split("-")[0] ?? name
  }

  // An answer that is only a reference is named after its type, which would drop a nullable field's null: such an
  // answer is wrapped, so it gets a name of its own that keeps it.
  const answerOf = (node: SchemaNode): SchemaNode =>
    node.type === "ref" && node.nullable
      ? { type: "allOf", of: [{ type: "ref", ref: node.ref }], nullable: true }
      : node

  const exclude = options.exclude ?? {}
  const excluded = new Set<string>()
  const operations: ApiOperation[] = []
  for (const [key, operation] of [
    ["queryType", "query"],
    ["mutationType", "mutation"],
  ] as const) {
    const root = rootName(key)
    if (!root) continue
    for (const field of fieldsOf(root) ?? []) {
      const scoped = `${operation}.${field.name}`
      const left = [scoped, field.name].find((name) => exclude[name] !== undefined)
      if (left !== undefined) {
        excluded.add(left)
        continue
      }
      const where = `${root}.${field.name}`
      const argument = (one: InputValue) => ({
        ...reference(one.type, `${where}(${one.name})`),
        ...described(one.description),
      })
      const required = field.args.filter((one) => one.type.kind === "NON_NULL" && one.defaultValue == null)
      const answer = named(field.type)
      const binding: GraphqlBinding = {
        kind: "graphql",
        operation,
        field: field.name,
        // A non-null argument with a default may be left out; declared non-null, its variable could not be.
        variables: Object.fromEntries(
          field.args.map((one) => [
            one.name,
            one.defaultValue != null && one.type.kind === "NON_NULL" && one.type.ofType
              ? typeText(one.type.ofType)
              : typeText(one.type),
          ]),
        ),
        selection: selectionOf(answer),
      }
      const deletes = operation === "mutation" && DELETES.test(field.name) && !UNDOES.test(field.name)
      const has = (name: string, type: string) =>
        field.args.some((one) => one.name === name && one.type.kind !== "NON_NULL" && named(one.type) === type)
      const pages =
        operation === "query" && field.type.kind !== "LIST" && connectionOf(answer) && has("after", "String")
      const pagination: Pagination | undefined = pages
        ? {
            style: "cursor",
            cursor: { in: "body", name: "after" },
            next: "pageInfo.endCursor",
            items: "nodes",
            hasMore: "pageInfo.hasNextPage",
            ...(has("first", "Int") ? { limit: { in: "body" as const, name: "first" } } : {}),
          }
        : undefined
      const summary = field.description?.split("\n")[0]
      operations.push({
        id: field.name,
        binding,
        ...(summary ? { summary } : {}),
        ...described(field.description),
        tags: [entityOf(field.name, operation), operation],
        parameters: field.args.map((one) => ({
          name: one.name,
          in: "body" as const,
          required: required.includes(one),
          ...described(one.description),
          schema: argument(one),
        })),
        ...(field.args.length > 0
          ? {
              requestBody: {
                confidence: "contract" as const,
                required: required.length > 0,
                schema: inputObject(field.args, where),
              },
            }
          : {}),
        response: { confidence: "contract", required: false, schema: answerOf(reference(field.type, where)) },
        effect: operation === "query" ? "read" : deletes ? "destructive" : "write",
        ...(deletes ? { effectReason: GRAPHQL_DELETE_REASON } : {}),
        ...(pagination ? { pagination, paginationSource: "detected" } : {}),
        ...(field.isDeprecated ? { deprecated: true } : {}),
        source: { location: where },
      })
    }
  }
  const stale = Object.keys(exclude).filter((name) => !excluded.has(name))
  if (stale.length > 0)
    throw new CodegenError(stale.map((name) => `exclusion "${name}" matches no field of Query or Mutation`))

  return {
    source: {
      kind: "other",
      sourceUrl: options.sourceUrl ?? options.url,
      ...(options.sourceRevision !== undefined ? { sourceRevision: options.sourceRevision } : {}),
    },
    operations: operations.sort((a, b) => a.id.localeCompare(b.id)),
    schemas,
    servers: [{ url: options.url }],
  }
}

/** The standard introspection query, deep enough for `[[Type!]!]!`. */
export const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      kind name description
      fields(includeDeprecated: true) { name description isDeprecated args { ...InputValue } type { ...TypeRef } }
      inputFields { ...InputValue }
      enumValues(includeDeprecated: true) { name }
      possibleTypes { name }
    }
  }
}
fragment InputValue on __InputValue { name description defaultValue type { ...TypeRef } }
fragment TypeRef on __Type {
  kind name
  ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } }
}`

const FILE = "schema.json"

export interface GraphqlProvenance {
  source: string
  /** Of the committed file; `readGraphql` refuses a snapshot that no longer matches it. */
  sha256: string
  retrieved_at: string
  normalization: string
}

const byName = (list: unknown): unknown =>
  Array.isArray(list)
    ? [...list].sort((a, b) => String((a as Json)?.name).localeCompare(String((b as Json)?.name)))
    : list

/**
 * Asks `url` for its schema and writes `schema.json` and `provenance.json` to `dir`. Run by hand, then review the diff:
 * the build never fetches. Types are sorted by name so a reordered answer is no diff. `headers` is for a service that
 * answers introspection only when signed in; nothing of them is written.
 */
export const syncGraphql = async (options: {
  url: string
  dir: string
  fetch?: typeof globalThis.fetch
  headers?: Readonly<Record<string, string>>
  now?: Date
}): Promise<GraphqlProvenance> => {
  const fetch = options.fetch ?? globalThis.fetch
  const response = await fetch(options.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...options.headers },
    body: JSON.stringify({ query: INTROSPECTION_QUERY }),
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  })
  if (!response.ok) throw new Error(`GraphQL introspection failed: HTTP ${response.status}`)
  const answer: unknown = await response.json()
  if (object(answer) && Array.isArray(answer.errors) && answer.errors.length > 0)
    throw new Error("GraphQL introspection failed: the service answered errors[]; it may need a sign-in")
  const schema = schemaOf(answer)
  const written = `${JSON.stringify(sortKeys({ __schema: { ...schema, types: byName(schema.types) } }), null, 2)}\n`
  const provenance: GraphqlProvenance = {
    source: options.url,
    sha256: sha256(written),
    retrieved_at: (options.now ?? new Date()).toISOString(),
    normalization: "types sorted by name, object keys sorted, 2-space JSON",
  }
  mkdirSync(options.dir, { recursive: true })
  writeFileSync(join(options.dir, FILE), written)
  writeFileSync(join(options.dir, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`)
  return provenance
}

/** The snapshot `syncGraphql` wrote, parsed. Throws if its hash changed. */
export const readGraphql = (dir: string): unknown => {
  const provenance = JSON.parse(readFileSync(join(dir, "provenance.json"), "utf8")) as { sha256?: string }
  const raw = readFileSync(join(dir, FILE))
  if (sha256(raw) !== provenance.sha256) throw new CodegenError([`GraphQL schema hash mismatch: ${join(dir, FILE)}`])
  return JSON.parse(raw.toString("utf8"))
}
