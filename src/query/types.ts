import { CliError } from "../errors.js"

export const QUERY_LIMITS = {
  bytes: 8192,
  depth: 32,
  nodes: 256,
} as const

export type Span = { start: number; end: number }
export type Occur = "must" | "should" | "mustNot"
export type Operator = "term" | "phrase" | "wildcard" | "regex" | "range"
export interface Predicate {
  kind: "predicate"
  field: string
  operator: Operator
  value: string
  upper?: string
  lowerInclusive?: boolean
  upperInclusive?: boolean
  span: Span
  /** A bare word, under no field. */
  implicit?: true
}
export type QueryNode = Predicate | { kind: "boolean"; clauses: { occur: Occur; node: QueryNode }[]; span: Span }
export interface QueryAst {
  version: 1
  language: "lucene-v1"
  root: QueryNode
}

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
