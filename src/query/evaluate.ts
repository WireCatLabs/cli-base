import { dateRange } from "./dates.js"
import type { FieldSpec } from "./fields.js"
import type { Predicate, QueryAst, QueryNode } from "./types.js"

export interface EvaluateOptions {
  zone?: string
  now?: number
  /** Decides a relation or `is:` term, which the item itself cannot. */
  relation?: (node: Predicate, item: Readonly<Record<string, unknown>>) => boolean
}

const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

const pattern = (value: string): RegExp =>
  new RegExp(
    `^${[...value]
      .map((char) => (char === "*" ? ".*" : char === "?" ? "." : char.replace(/[.+^${}()|[\]\\]/, "\\$&")))
      .join("")}$`,
    "iu",
  )

const present = (value: unknown) => value !== undefined && value !== null && value !== ""

const matchOne = (field: FieldSpec, node: Predicate, value: unknown, options: EvaluateOptions): boolean => {
  if (!present(value)) return false
  if (node.operator === "wildcard" && node.value === "*") return true
  const text = String(value)
  switch (field.type) {
    case "txt": {
      const words = wordsOf(text)
      if (node.operator === "wildcard") return words.some((word) => pattern(node.value).test(word))
      const wanted = wordsOf(node.value)
      return words.some((_, at) => wanted.every((word, offset) => words[at + offset] === word))
    }
    case "num": {
      const number = Number(value)
      if (node.operator !== "range") return number === Number(node.value)
      const { value: lower, upper = "*", lower_inclusive: lowerInclusive, upper_inclusive: upperInclusive } = node
      return (
        (lower === "*" || (lowerInclusive ? number >= Number(lower) : number > Number(lower))) &&
        (upper === "*" || (upperInclusive ? number <= Number(upper) : number < Number(upper)))
      )
    }
    case "time": {
      const time = Date.parse(text)
      const [lower, upper, lowerInclusive, upperInclusive] =
        node.operator === "range"
          ? [node.value, node.upper ?? "*", node.lower_inclusive ?? true, node.upper_inclusive ?? true]
          : [node.value, node.value, true, true]
      const range = dateRange(
        lower,
        upper,
        lowerInclusive,
        upperInclusive,
        options.zone ?? "UTC",
        node.span,
        options.now,
      )
      return (
        (range.lower === undefined || (range.lower_inclusive ? time >= range.lower : time > range.lower)) &&
        (range.upper === undefined || (range.upper_inclusive ? time <= range.upper : time < range.upper))
      )
    }
    default:
      return node.operator === "wildcard"
        ? pattern(node.value).test(text)
        : text.toLowerCase() === node.value.toLowerCase()
  }
}

const matches = (
  node: QueryNode,
  item: Readonly<Record<string, unknown>>,
  byName: ReadonlyMap<string, FieldSpec>,
  options: EvaluateOptions,
): boolean => {
  if (node.kind === "boolean") {
    const by = (occur: string) => node.clauses.filter((clause) => clause.occur === occur)
    const [must, should, mustNot] = [by("must"), by("should"), by("must_not")]
    const holds = (clause: { node: QueryNode }) => matches(clause.node, item, byName, options)
    return must.every(holds) && !mustNot.some(holds) && (should.length === 0 || must.length > 0 || should.some(holds))
  }
  const field = byName.get(node.field)
  if (!field) throw new Error(`evaluate: no field "${node.field}"; validate the query first`)
  if (field.relation !== undefined) {
    if (!options.relation) throw new Error(`evaluate: "${node.field}" is a relation; pass options.relation`)
    return options.relation(node, item)
  }
  const value = item[node.field]
  return Array.isArray(value)
    ? value.some((one) => matchOne(field, node, one, options))
    : matchOne(field, node, value, options)
}

/**
 * Whether one item matches a validated query. The oracle the store and provider compilers are tested
 * against — never a way to filter a list: lists filter where their data lives. A query of only NOT terms
 * matches everything else.
 */
export const evaluate = (
  ast: QueryAst,
  fields: readonly FieldSpec[],
  item: Readonly<Record<string, unknown>>,
  options: EvaluateOptions = {},
): boolean => matches(ast.root, item, new Map(fields.map((field) => [field.name, field])), options)
