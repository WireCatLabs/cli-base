import type { QueryRegistry } from "./fields.js"
import type { FieldInfo } from "./registry.js"

export const QUERY_SYNTAX = 'field:value · "a phrase" · word* · AND OR NOT · ( ) · [a TO b] · > >= < <='

const kindOf = (field: FieldInfo): string =>
  field.values ? `${field.type}: ${field.values.join("|")}` : `${field.type}: ${field.operators.join(", ")}`

/** The Fields section of a list's help: one line per field it filters by, its defaults, the syntax and the guide. */
export const fieldsHelp = (
  registry: Pick<QueryRegistry, "fields" | "defaults"> & Partial<Pick<QueryRegistry, "backend">>,
  guide?: string,
): string => {
  const shown = registry.backend === "native" ? registry.fields.filter((field) => field.native) : registry.fields
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
    `Syntax: ${QUERY_SYNTAX}`,
    ...(guide ? [`Guide: ${guide}`] : []),
  ].join("\n")
}
