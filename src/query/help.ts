import type { QueryRegistry } from "./fields.js"
import type { FieldInfo } from "./registry.js"

export const QUERY_SYNTAX = 'field:value · "a phrase" · word* · AND OR NOT · ( ) · [a TO b] · > >= < <='

const shownOf = (registry: Pick<QueryRegistry, "fields"> & Partial<Pick<QueryRegistry, "backend">>) =>
  registry.backend === "native" ? registry.fields.filter((field) => field.native) : registry.fields

const leftOut = (fields: readonly FieldInfo[]) => fields.filter((field) => field.negatable).map((field) => field.name)

const kindOf = (field: FieldInfo): string =>
  field.values ? `${field.type}: ${field.values.join("|")}` : `${field.type}: ${field.operators.join(", ")}`

/** The Fields section of a list's help: one line per field it filters by, its defaults, the syntax and the guide. */
export const fieldsHelp = (
  registry: Pick<QueryRegistry, "fields" | "defaults"> & Partial<Pick<QueryRegistry, "backend">>,
  guide?: string,
): string => {
  const shown = shownOf(registry)
  const negatable = leftOut(shown)
  const rows = shown.map((field) => [field.name, kindOf(field), field.example])
  const widths = [0, 1].map((at) => Math.max(...rows.map((row) => (row[at] ?? "").length)))
  return [
    "Fields:",
    ...rows.map(([name = "", kind = "", example = ""]) =>
      `  ${name.padEnd(widths[0] ?? 0)}  ${kind.padEnd(widths[1] ?? 0)}  ${example}`.trimEnd(),
    ),
    ...(registry.defaults && registry.defaults.length > 0
      ? [`Defaults: ${registry.defaults.join(" ")} — name the field to change it`]
      : []),
    ...(negatable.length > 0
      ? [`Leave out: -${negatable[0]}:value or NOT ${negatable[0]}:value, for ${negatable.join(", ")}`]
      : []),
    `Syntax: ${QUERY_SYNTAX}`,
    ...(guide ? [`Guide: ${guide}`] : []),
  ].join("\n")
}

/**
 * A list's query in one sentence, for an input with no help page beside it (an MCP tool's `query`): the terms the
 * list takes, which fields may be left out with `-`, and every field it filters by.
 */
export const queryDescription = (
  registry: Pick<QueryRegistry, "fields"> & Partial<Pick<QueryRegistry, "backend" | "defaults">>,
): string => {
  const shown = shownOf(registry)
  if (shown.length === 0) return "field:value terms; this list filters by none yet, so any term is refused"
  const negatable = leftOut(shown)
  const terms =
    registry.backend === "native"
      ? `field:value terms joined by AND that narrow the list${
          negatable.length > 0
            ? `; -field:value or NOT field:value leaves out what matches, for ${negatable.join(", ")} only`
            : ""
        }`
      : "field:value terms that narrow the list (Lucene: AND OR NOT, -field:value, [a TO b], > <)"
  const fields = shown.map((field) => (field.values ? `${field.name} (${field.values.join("|")})` : field.name))
  const defaults = registry.defaults?.length ? `; unless named: ${registry.defaults.join(" ")}` : ""
  return `${terms}; fields: ${fields.join(", ")}; e.g. ${shown[0]?.example ?? ""}${defaults}`
}
