import { isCliError } from "../errors.js"
import { defineReasons } from "../standards/errors.js"
import { duplicates, RegistryError, SNAKE_CASE } from "../standards/registry.js"
import type { FieldSpec, QueryRegistry } from "./fields.js"
import { parseLucene } from "./parser.js"
import { walkQuery } from "./types.js"
import { validateQuery } from "./validate.js"

/** A field as `commands --json` carries it: everything but the hook. */
export type FieldInfo = Omit<FieldSpec, "validate">
export interface QueryInfo extends Omit<QueryRegistry, "fields"> {
  fields: FieldInfo[]
}

export const describeQuery = (registry: QueryRegistry): QueryInfo => ({
  entity: registry.entity,
  backend: registry.backend,
  fields: registry.fields.map(({ validate: _, ...field }) => field),
  ...(registry.defaults && registry.defaults.length > 0 ? { defaults: [...registry.defaults] } : {}),
})

/** Why an example or default term would not run against these fields, per field name; empty when every one runs. */
export const exampleProblems = (registry: QueryRegistry): { field: string; problem: string }[] => {
  // An example proves syntax and type; whether a provider filters the field is the list's answer at run time.
  const syntaxOnly: QueryRegistry = { ...registry, backend: "sql" }
  const problem = (text: string, field: string): string | undefined => {
    try {
      const named = walkQuery(validateQuery(parseLucene(text, { defaultField: "none" }), syntaxOnly).root)
      return named.every((node) => node.field === field) ? undefined : `"${text}" does not name ${field}`
    } catch (failure) {
      if (!isCliError(failure)) throw failure
      return `"${text}": ${failure.message}`
    }
  }
  const defaults = (registry.defaults ?? []).map((term) => {
    const field = term.replace(/^-/, "").split(/[:<>=]/)[0] ?? ""
    return { field, problem: problem(term.replace(/^-/, ""), field) }
  })
  return [
    ...registry.fields.map((field) => ({ field: field.name, problem: problem(field.example, field.name) })),
    ...defaults,
  ].filter((entry): entry is { field: string; problem: string } => entry.problem !== undefined)
}

/** One list's query: field names unique and snake_case, every example and default runs. Throws naming every problem. */
export const defineQuery = (registry: QueryRegistry): QueryRegistry => {
  const names = registry.fields.map((field) => field.name)
  const problems = [
    ...duplicates(names).map((name) => `"${name}" is listed twice`),
    ...names.filter((name) => !SNAKE_CASE.test(name)).map((name) => `"${name}" is not snake_case`),
    ...exampleProblems(registry).map(({ field, problem }) => `${field}: ${problem}`),
  ]
  if (problems.length > 0) throw new RegistryError(`${registry.entity} query`, problems)
  return registry
}

const SPAN = ["span", "alternative", "guide"]

/** The query reasons every CLI shares; a CLI adds its own (`query.invalid-tag`) with `defineReasons`. */
export const QUERY_REASONS = defineReasons(
  (
    [
      ["query.bare-word", "a word in the query has no field", ["word"]],
      ["query.invalid-ast", "the query tree is not valid", []],
      ["query.invalid-date", "a date in the query cannot be read", []],
      ["query.invalid-escape", "an escape in the query is not valid", []],
      ["query.invalid-number", "a number in the query cannot be read", []],
      ["query.invalid-regex", "a regular expression in the query is not valid", []],
      ["query.invalid-syntax", "the query cannot be parsed", []],
      ["query.invalid-timezone", "the time zone is not known", []],
      ["query.missing-value", "a field in the query has no value", []],
      ["query.too-large", "the query is over one of its limits", []],
      ["query.unclosed-literal", "a quote or bracket in the query is not closed", []],
      ["query.unknown-field", "a field in the query is not known", ["fields"]],
      ["query.unknown-value", "a value in the query is not known", []],
      ["query.unsupported-field", "this list cannot filter by that field", ["supported"]],
      ["query.unsupported-operator", "this field does not take that operator", []],
      ["query.unsupported-placement", "this field works only as a required term", []],
      ["query.unsupported-regex", "that regular expression is not supported", []],
      ["query.unsupported-regex-flags", "regular expression flags are not supported", []],
      ["query.unsupported-version", "the query version is not supported", []],
    ] as const
  ).map(([reason, message, details]) => ({
    reason,
    code: "validation_error",
    message,
    details: [...SPAN, ...details],
  })),
)
