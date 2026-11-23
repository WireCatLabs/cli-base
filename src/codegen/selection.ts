/** The two GraphQL helpers a CLI calls at run time, apart from the adapter so they load no codegen code. */
import type { GraphqlBinding } from "./model.js"

/** Builds the one document an operation sends: every variable declared and passed, the selection inside. */
export const graphqlDocument = (binding: GraphqlBinding, selection: string = binding.selection): string => {
  const variables = Object.entries(binding.variables)
  const declared = variables.length ? `(${variables.map(([name, type]) => `$${name}: ${type}`).join(", ")})` : ""
  const passed = variables.length ? `(${variables.map(([name]) => `${name}: $${name}`).join(", ")})` : ""
  const inner = selection.trim() ? ` { ${selection.trim()} }` : ""
  return `${binding.operation} ${binding.field[0]?.toUpperCase()}${binding.field.slice(1)}${declared} { ${binding.field}${passed}${inner} }`
}

/** A selection as a tree: a field's name → its own selection, or `true` for a leaf. */
export interface Selection {
  readonly [field: string]: Selection | true
}

/**
 * `id title state { id type }` → its tree. Only names and braces: an argument, an alias, a fragment or a directive
 * throws, since nothing here can check one.
 */
export const parseSelection = (text: string): Selection => {
  const tokens = text.match(/[_A-Za-z][_0-9A-Za-z]*|[{}]|\S/g) ?? []
  let at = 0
  const level = (nested: boolean): Selection => {
    const fields: Record<string, Selection | true> = {}
    while (at < tokens.length) {
      const token = tokens[at] as string
      if (token === "}") {
        if (!nested) throw new Error(`selection "${text}": an unmatched }`)
        at += 1
        return fields
      }
      if (!/^[_A-Za-z]/.test(token))
        throw new Error(`selection "${text}": "${token}" — only field names and braces are supported`)
      at += 1
      if (tokens[at] === "{") {
        at += 1
        const inner = level(true)
        if (Object.keys(inner).length === 0) throw new Error(`selection "${text}": ${token} selects nothing`)
        fields[token] = inner
      } else fields[token] = true
    }
    if (nested) throw new Error(`selection "${text}": a { is not closed`)
    return fields
  }
  return level(false)
}
