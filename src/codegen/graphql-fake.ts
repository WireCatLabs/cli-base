/**
 * A strict fake of a GraphQL service, built from the files `generate` wrote, in the spirit of `fakeApi`: a `fetch` that
 * takes only a POST of a document `graphqlDocument` builds for an operation the manifest has, refuses a selection
 * field the type lacks, variables that break their schema and a missing sign-in, and answers `data.<field>` within
 * the selection. A test writes only its scenarios; one that answers outside the schema or the selection throws.
 */

import { sampleOf, schemaProblems } from "./fake.js"
import type { ManifestOperation } from "./manifest.js"
import type { GraphqlBinding, SchemaNode } from "./model.js"
import { identifier } from "./names.js"
import { graphqlDocument, parseSelection, type Selection } from "./selection.js"

type Definitions = Readonly<Record<string, SchemaNode>>

export interface GraphqlFakeCall {
  /** The matched operation's id; absent when the request matched none. */
  operation?: string
  query: string
  selection?: Selection
  variables: Readonly<Record<string, unknown>>
  headers: Headers
}

/** `data` is the field's answer; `errors` are sent as GraphQL's, with HTTP 200 unless `status` says otherwise. */
export interface GraphqlFakeAnswer {
  status?: number
  data?: unknown
  errors?: readonly { message: string; extensions?: Readonly<Record<string, unknown>> }[]
  headers?: Readonly<Record<string, string>>
}

type Answering = (call: GraphqlFakeCall) => GraphqlFakeAnswer | Promise<GraphqlFakeAnswer>

export interface GraphqlFakeOptions {
  operations: readonly ManifestOperation[]
  definitions: Definitions
  /** The endpoint: `https://api.linear.app/graphql`. */
  url: string
  /** The header and value every call must carry: `{ header: "Authorization", value: "<key>" }`. */
  auth?: { header: string; value: string }
  /** Answers by operation id; one without an answer gets a sample of its selection. */
  answers?: Readonly<Record<string, Answering>>
}

export interface GraphqlFake {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  calls: GraphqlFakeCall[]
  /** Why each refused call was refused; a test that expects none asserts this is empty. */
  refusals: string[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

type ObjectNode = Extract<SchemaNode, { type: "object" }>
type Shape = { kind: "leaf" } | { kind: "union" } | { kind: "object"; objects: ObjectNode[] }

/** What a selection walks into, through references, lists and a nullable wrapper: an object, a union or a leaf. */
const shapeOf = (node: SchemaNode, definitions: Definitions, depth = 0): Shape => {
  if (depth > 20) return { kind: "leaf" }
  switch (node.type) {
    case "ref": {
      const target = definitions[identifier(node.ref)]
      return target ? shapeOf(target, definitions, depth + 1) : { kind: "leaf" }
    }
    case "array":
      return shapeOf(node.items, definitions, depth + 1)
    case "allOf": {
      const objects = node.of.flatMap((one) => {
        const inner = shapeOf(one, definitions, depth + 1)
        return inner.kind === "object" ? inner.objects : []
      })
      return objects.length > 0 ? { kind: "object", objects } : { kind: "leaf" }
    }
    case "union":
      return { kind: "union" }
    case "object":
      return { kind: "object", objects: [node] }
    default:
      return { kind: "leaf" }
  }
}

/**
 * Every field the selection names that the type lacks, a leaf asked without a selection, or an object asked with one.
 * On a union only `__typename` is selectable: its members' fields need fragments, which a selection here never has.
 */
export const selectionProblems = (
  selection: Selection,
  node: SchemaNode,
  definitions: Definitions,
  where = "selection",
): string[] => {
  const shape = shapeOf(node, definitions)
  if (shape.kind === "leaf") return [`${where}: a scalar has no fields to select`]
  return Object.entries(selection).flatMap(([name, inner]) => {
    if (name === "__typename") return inner === true ? [] : [`${where}.__typename: a scalar has no fields to select`]
    if (shape.kind === "union") return [`${where}.${name}: a union takes only __typename`]
    const property = shape.objects.map((one) => one.properties[name]).find(Boolean)
    if (!property) return [`${where}.${name}: no such field`]
    const leaf = shapeOf(property, definitions).kind === "leaf"
    if (inner === true) return leaf ? [] : [`${where}.${name}: an object needs a selection`]
    return selectionProblems(inner, property, definitions, `${where}.${name}`)
  })
}

/** Every field of the answer outside the selection. */
const outside = (value: unknown, selection: Selection, where: string): string[] => {
  if (Array.isArray(value)) return value.flatMap((one, index) => outside(one, selection, `${where}[${index}]`))
  if (!isObject(value)) return []
  return Object.entries(value).flatMap(([name, inner]) => {
    const asked = selection[name]
    if (asked === undefined) return [`${where}.${name}: not selected`]
    return asked === true ? [] : outside(inner, asked, `${where}.${name}`)
  })
}

/** A value of the type with only the selected fields. */
const sampleWithin = (node: SchemaNode, selection: Selection | true, definitions: Definitions): unknown => {
  if (selection === true) return sampleOf(node, definitions)
  if (node.type === "ref") {
    const target = definitions[identifier(node.ref)]
    return target ? sampleWithin(target, selection, definitions) : null
  }
  if (node.type === "array") return [sampleWithin(node.items, selection, definitions)]
  const shape = shapeOf(node, definitions)
  const objects = shape.kind === "object" ? shape.objects : []
  return Object.fromEntries(
    Object.entries(selection).map(([name, inner]) => [
      name,
      name === "__typename"
        ? "Object"
        : sampleWithin(
            objects.map((one) => one.properties[name]).find(Boolean) ?? { type: "unknown" },
            inner,
            definitions,
          ),
    ]),
  )
}

const json = (status: number, body: unknown, headers: Readonly<Record<string, string>> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

/** The selection inside a document built for `binding`, or `undefined` when it was not built so. */
const selectionIn = (binding: GraphqlBinding, query: string): string | undefined => {
  const marker = "\u0000"
  const [head = "", tail = ""] = graphqlDocument(binding, marker).split(marker)
  if (query === graphqlDocument(binding, "")) return ""
  if (!query.startsWith(head) || !query.endsWith(tail) || query.length < head.length + tail.length) return undefined
  return query.slice(head.length, query.length - tail.length)
}

export const graphqlFake = (options: GraphqlFakeOptions): GraphqlFake => {
  const calls: GraphqlFakeCall[] = []
  const refusals: string[] = []
  const { definitions } = options
  const endpoint = new URL(options.url).href
  const refuse = (status: number, problems: readonly string[]) => {
    for (const problem of problems) refusals.push(problem)
    return json(status, { errors: problems.map((message) => ({ message, extensions: { code: "FAKE_REFUSED" } })) })
  }
  const graphql = options.operations.filter(
    (one): one is ManifestOperation & { binding: GraphqlBinding } => one.binding.kind === "graphql",
  )

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    let body: unknown
    try {
      body = JSON.parse(await request.text())
    } catch {
      body = undefined
    }
    const query = isObject(body) && typeof body.query === "string" ? body.query : ""
    const variables = isObject(body) && isObject(body.variables) ? body.variables : {}
    const call: GraphqlFakeCall = { query, variables, headers: request.headers }
    calls.push(call)
    if (request.url !== endpoint) return refuse(404, [`${request.url} is not ${endpoint}`])
    if (request.method !== "POST") return refuse(405, [`a GraphQL call is a POST, not ${request.method}`])
    if (!query) return refuse(400, ["the body is not JSON with a query"])
    if (options.auth && request.headers.get(options.auth.header) !== options.auth.value)
      return refuse(401, [`no ${options.auth.header} header with the expected sign-in`])
    const found = graphql
      .map((operation) => ({ operation, text: selectionIn(operation.binding, query) }))
      .find((one) => one.text !== undefined)
    if (!found) return refuse(400, [`no operation of the manifest builds the document: ${query.slice(0, 120)}`])
    const { operation } = found
    call.operation = operation.id
    const response = operation.response?.schema ? definitions[operation.response.schema] : undefined
    let selection: Selection = {}
    const parseProblems: string[] = []
    try {
      selection = parseSelection(found.text ?? "")
      call.selection = selection
    } catch (error) {
      parseProblems.push(`${operation.id}: ${(error as Error).message}`)
    }
    const variablesSchema = operation.request?.schema ? definitions[operation.request.schema] : undefined
    const problems = [
      ...parseProblems,
      ...(response && found.text ? selectionProblems(selection, response, definitions, operation.id) : []),
      ...(response && !found.text && shapeOf(response, definitions).kind !== "leaf"
        ? [`${operation.id}: an object needs a selection`]
        : []),
      ...(variablesSchema
        ? schemaProblems(variables, variablesSchema, definitions, "variables")
        : Object.keys(variables).map((name) => `${operation.id}: takes no argument "${name}"`)),
    ]
    if (problems.length > 0) return refuse(400, problems)

    const answering = options.answers?.[operation.id]
    if (!answering) {
      const data = response
        ? found.text
          ? sampleWithin(response, selection, definitions)
          : sampleOf(response, definitions)
        : null
      return json(200, { data: { [operation.binding.field]: data } })
    }
    const { status = 200, data, errors, headers } = await answering(call)
    if (errors?.length) return json(status, { data: null, errors }, headers)
    if (status >= 200 && status < 300 && response && data !== undefined) {
      const wrong = [
        ...schemaProblems(data, response, definitions, "answer"),
        ...(found.text ? outside(data, selection, "answer") : []),
      ]
      if (wrong.length > 0)
        throw new Error(`the answer for ${operation.id} breaks its schema or selection: ${wrong.join("; ")}`)
    }
    return json(status, { data: { [operation.binding.field]: data ?? null } }, headers)
  }
  return { fetch, calls, refusals }
}
