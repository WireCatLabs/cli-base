import * as v from "valibot"
import { CliError } from "../errors.js"

export const QUERY_LIMITS = {
  bytes: 8192,
  depth: 32,
  nodes: 256,
} as const

export type Span = { start: number; end: number }
export type Occur = "must" | "should" | "must_not"
export type Operator = "term" | "phrase" | "wildcard" | "regex" | "range"
export interface Predicate {
  kind: "predicate"
  field: string
  operator: Operator
  value: string
  upper?: string
  lower_inclusive?: boolean
  upper_inclusive?: boolean
  span: Span
  /** A bare word, under no field. */
  implicit?: true
  /** `"a b"~N`, read only when the parser is asked to: how far apart the phrase's words may be. */
  slop?: number
}
export type QueryNode = Predicate | { kind: "boolean"; clauses: { occur: Occur; node: QueryNode }[]; span: Span }
export interface QueryAst {
  version: 1
  language: "lucene-v1"
  root: QueryNode
}

const spanSchema = v.object({ start: v.number(), end: v.number() })
const predicateSchema = v.object({
  kind: v.literal("predicate"),
  field: v.string(),
  operator: v.picklist(["term", "phrase", "wildcard", "regex", "range"]),
  value: v.string(),
  upper: v.optional(v.string()),
  lower_inclusive: v.optional(v.boolean()),
  upper_inclusive: v.optional(v.boolean()),
  span: spanSchema,
  implicit: v.optional(v.literal(true)),
  slop: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
})
export const queryNodeSchema: v.GenericSchema<QueryNode> = v.variant("kind", [
  predicateSchema,
  v.object({
    kind: v.literal("boolean"),
    clauses: v.array(
      v.object({ occur: v.picklist(["must", "should", "must_not"]), node: v.lazy(() => queryNodeSchema) }),
    ),
    span: spanSchema,
  }),
])
/** The parsed tree as JSON: what an MCP `ast` argument and a saved search carry. */
export const queryAstSchema = v.object({
  version: v.literal(1),
  language: v.literal("lucene-v1"),
  root: queryNodeSchema,
})

/** Who reports a query error: `chats list`, `search`. Without it the message starts with `query:`. */
export interface QueryContext {
  command?: string
  /** Where the query language is explained. */
  guide?: string
}

export function queryError(
  reason: string,
  span: Span,
  alternative?: string,
  context: QueryContext = {},
  details: Record<string, unknown> = {},
): never {
  throw new CliError(
    "validation_error",
    `${context.command ?? "query"}: ${reason} at position ${span.start + 1}${alternative ? ` — ${alternative}` : ""}`,
    {
      reason,
      span,
      ...(alternative ? { alternative } : {}),
      ...(context.guide ? { guide: context.guide } : {}),
      ...details,
    },
  )
}

export const walkQuery = (node: QueryNode): Predicate[] =>
  node.kind === "predicate" ? [node] : node.clauses.flatMap(({ node }) => walkQuery(node))
