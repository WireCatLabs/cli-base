import { isCliError } from "../errors.js"
import { dateEndpoint } from "./dates.js"
import type { FieldSpec, QueryRegistry } from "./fields.js"
import { type Predicate, type QueryAst, type QueryContext, type QueryNode, queryError, walkQuery } from "./types.js"

export interface ValidateOptions extends QueryContext {
  /** Day boundaries in time values; validity does not depend on it but for a day a zone skips. */
  zone?: string
}

// dates.ts raises without a command; its errors are re-raised here under the command that ran.
const inContext = (context: QueryContext, run: () => void) => {
  try {
    run()
  } catch (failure) {
    if (!isCliError(failure) || typeof failure.details.reason !== "string") throw failure
    const { reason, span, alternative } = failure.details as {
      reason: string
      span: Predicate["span"]
      alternative?: string
    }
    queryError(reason, span, alternative, context)
  }
}

const bounds = (node: Predicate): string[] =>
  node.operator === "range" ? [node.value, node.upper ?? "*"].filter((bound) => bound !== "*") : [node.value]

const checkValue = (field: FieldSpec, node: Predicate, options: ValidateOptions) => {
  const fail = (reason: string, alternative?: string) => queryError(reason, node.span, alternative, options)
  if (node.value === "" && field.type !== "txt") fail("query.missing-value")
  if (node.operator === "wildcard") return
  switch (field.type) {
    case "enum":
      if (!field.values?.includes(node.value.toLowerCase()))
        fail("query.unknown-value", `${field.name} takes ${field.values?.join(", ")}`)
      return
    case "bool":
      if (!["true", "false"].includes(node.value.toLowerCase()))
        fail("query.unknown-value", `${field.name} takes true, false`)
      return
    case "num":
      for (const bound of bounds(node))
        if (!Number.isFinite(Number(bound)) || bound.trim() === "")
          fail("query.invalid-number", `${field.name} takes a number`)
      return
    case "time":
      inContext(options, () => {
        for (const bound of bounds(node)) dateEndpoint(bound, options.zone ?? "UTC", "lower", true, node.span)
      })
      return
    default:
      return
  }
}

/** Checks every term against the list's fields: name, operator, value by type, placement, the field's own hook. */
export const validateQuery = (ast: QueryAst, registry: QueryRegistry, options: ValidateOptions = {}): QueryAst => {
  const byName = new Map(registry.fields.map((field) => [field.name, field]))
  const visit = (node: QueryNode, required: boolean) => {
    if (node.kind === "boolean") {
      for (const clause of node.clauses) visit(clause.node, required && clause.occur === "must")
      return
    }
    const field = byName.get(node.field)
    if (!field)
      queryError("query.unknown-field", node.span, `no field "${node.field}"`, options, {
        fields: registry.fields.map((one) => one.name),
      })
    if (registry.backend === "native" && !field.native)
      queryError("query.unsupported-field", node.span, `the source cannot filter by ${field.name}`, options, {
        supported: registry.fields.filter((one) => one.native).map((one) => one.name),
      })
    // `field:*` asks whether the field has a value, which every type answers.
    const presence = node.operator === "wildcard" && node.value === "*"
    if (!presence && !field.operators.includes(node.operator))
      queryError("query.unsupported-operator", node.span, `${field.name} takes ${field.operators.join(", ")}`, options)
    if (field.placement === "and" && !required)
      queryError(
        "query.unsupported-placement",
        node.span,
        `${field.name} only as a required term, not under OR or NOT`,
        options,
      )
    if (presence) return
    checkValue(field, node, options)
    if (field.validate) inContext(options, () => field.validate?.(node))
  }
  visit(ast.root, true)
  return ast
}

/** The fields a query names, so a default on a field the query names is lifted. */
export const fieldsNamed = (ast: QueryAst): Set<string> => new Set(walkQuery(ast.root).map((node) => node.field))
