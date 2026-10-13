import { toJsonSchema } from "@valibot/to-json-schema"
import * as v from "valibot"

export const word = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "a lower-case word, words joined by -"))
export const text = v.pipe(v.string(), v.regex(/\S/, "must not be empty"))
export const dottedId = v.pipe(
  v.string(),
  v.regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, "dotted lower-case words, such as `page.next`"),
)

export class RegistryError extends Error {
  constructor(
    readonly registry: string,
    readonly problems: readonly string[],
  ) {
    super(`${registry} registry: ${problems.join("; ")}`)
    this.name = "RegistryError"
  }
}

export const issuesOf = (issues: readonly v.BaseIssue<unknown>[]): string[] =>
  issues.map((issue) => {
    const path = v.getDotPath(issue)
    return path ? `${path}: ${issue.message}` : issue.message
  })

/** Parses a registry, then runs its own checks over the parsed entries; throws one error naming every problem. */
export const parseRegistry = <S extends v.GenericSchema>(
  registry: string,
  schema: S,
  input: unknown,
  check: (parsed: v.InferOutput<S>) => string[] = () => [],
): v.InferOutput<S> => {
  const parsed = v.safeParse(schema, input)
  if (!parsed.success) throw new RegistryError(registry, issuesOf(parsed.issues))
  const problems = check(parsed.output)
  if (problems.length > 0) throw new RegistryError(registry, problems)
  return parsed.output
}

export const duplicates = (values: readonly string[]): string[] =>
  [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort()

export const jsonSchemaOf = (schema: v.GenericSchema, definitions?: Record<string, v.GenericSchema>) =>
  toJsonSchema(schema, { target: "draft-2020-12", ...(definitions ? { definitions } : {}) })

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g

export const placeholders = (template: string): string[] =>
  [...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "")

/** Fills `{name}` from `values`; a placeholder with no value throws, so a half-filled sentence never ships. */
export const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replace(PLACEHOLDER, (_, name: string) => {
    const value = values[name]
    if (value === undefined) throw new Error(`no value for {${name}} in "${template}"`)
    return String(value)
  })
