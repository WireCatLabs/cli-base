import * as v from "valibot"
import { type CommandsDocument, commandsDocumentJsonSchema } from "../commands/document.js"
import type { CommandInfo, OptionInfo } from "../commands/index.js"
import { exampleProblems } from "../query/registry.js"
import { queryAstSchema, queryNodeSchema } from "../query/types.js"
import { errorObjectSchema } from "../standards/errors.js"
import { LINT_RULES, type LintRule, type Override } from "../standards/lint.js"
import { isContentKey, logAttributesJsonSchema, logRecordSchema } from "../standards/log.js"
import { itemEnvelopeSchema, listEnvelopeSchema } from "../standards/output.js"
import { jsonSchemaOf, SNAKE_CASE } from "../standards/registry.js"
import type { Vocabulary } from "../standards/vocabulary.js"

export interface Violation {
  rule: string
  /** What the baseline and overrides name: `chats list`, `chats show <chat>`, `chats list --limit`, `--until`. */
  target: string
  message: string
}

const SUMMARY_LIMIT = 80
const EXAMPLES_MIN = 1
const EXAMPLES_MAX = 3
/** STANDARD's search hierarchy: `search <resource>`, and `search all` for every resource. */
const SEARCH_ROOT = "search"
const SEARCH_EVERYTHING = "all"

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const walk = (commands: readonly CommandInfo[]): CommandInfo[] =>
  commands.flatMap((one) => [one, ...walk(one.commands)])

const longName = (flags: string): string => flags.split(/[ ,|]+/).find((part) => part.startsWith("--")) ?? flags

/** A flag's kind of value: its value name, or `switch`. Two kinds under one name are two meanings. */
const kindOf = (option: OptionInfo): string => {
  if (!option.takes_value) return "switch"
  return option.flags.match(/[<[]([^>\]]+)[>\]]/)?.[1]?.toLowerCase() ?? "value"
}

const summaryOf = (command: CommandInfo): string => (command.summary ?? command.description.split("\n")[0] ?? "").trim()

const label = (command: CommandInfo): string => command.path.join(" ")

export interface LintContext {
  /** The commands document as the CLI printed it; parsing drops keys it does not know, so casing is checked here. */
  raw?: unknown
  /**
   * The CLI's own JSON Schemas by name — entities, envelopes — checked by `key-casing` beside cli-base's.
   * `log_attributes` (`logAttributesJsonSchema(allow)`) is the CLI's log allow-list, for `log-attribute-key`.
   */
  schemas?: Readonly<Record<string, unknown>>
}

/** The `--schemas` entry holding the CLI's log allow-list; its keys are camelCase, so `key-casing` skips it. */
const LOG_ATTRIBUTES = "log_attributes"

type Check = (document: CommandsDocument, vocabulary: Vocabulary, context: LintContext) => Omit<Violation, "rule">[]

/** The schemas cli-base itself defines; every CLI's lint checks them too. */
export const baseSchemas = (): Record<string, unknown> => ({
  list_envelope: jsonSchemaOf(listEnvelopeSchema(v.unknown())),
  item_envelope: jsonSchemaOf(itemEnvelopeSchema(v.unknown())),
  error_object: jsonSchemaOf(errorObjectSchema),
  log_record: jsonSchemaOf(logRecordSchema),
  commands_document: commandsDocumentJsonSchema(),
  query_ast: jsonSchemaOf(queryAstSchema, { query_node: queryNodeSchema }),
})

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Property names a JSON Schema declares, by path. A record's keys are data (`additionalProperties`), not checked. */
const schemaKeys = (schema: unknown, path: string): [string, string][] => {
  if (Array.isArray(schema)) return schema.flatMap((one) => schemaKeys(one, path))
  if (!isObject(schema)) return []
  const own = isObject(schema.properties)
    ? Object.entries(schema.properties).flatMap(([key, value]): [string, string][] => [
        [key, path ? `${path}.${key}` : key],
        ...schemaKeys(value, path ? `${path}.${key}` : key),
      ])
    : []
  const defs = isObject(schema.$defs)
    ? Object.entries(schema.$defs).flatMap(([name, value]) => schemaKeys(value, `$defs.${name}`))
    : []
  const nested = ["items", "prefixItems", "anyOf", "oneOf", "allOf", "additionalProperties"].flatMap((at) =>
    schemaKeys(schema[at], at === "items" || at === "prefixItems" ? `${path}[]` : path),
  )
  return [...own, ...defs, ...nested]
}

/** Values under these keys are data: Commander's flags, defaults, exit code names. */
const DATA_KEYS = new Set(["implies", "default", "exit_codes"])

/** Every key of the live document by its structural path, `commands[].options[].takes_value`, each path once. */
const documentKeys = (value: unknown, path: string): [string, string][] => {
  if (Array.isArray(value)) return value.flatMap((item) => documentKeys(item, `${path}[]`))
  if (!isObject(value)) return []
  return Object.entries(value).flatMap(([key, item]): [string, string][] => {
    const at = path ? `${path}.${key}` : key
    return [[key, at], ...(DATA_KEYS.has(key) ? [] : documentKeys(item, key === "commands" ? "commands" : at))]
  })
}

const handwrittenLeaves = (document: CommandsDocument): CommandInfo[] =>
  walk(document.commands).filter((command) => command.commands.length === 0 && command.origin === "handwritten")

/** Splits an example the way a shell would for the quoting examples use: '…', "…" and a backslash. */
export const exampleWords = (line: string): string[] =>
  [...line.matchAll(/(?:'[^']*'|"(?:\\.|[^"\\])*"|\\.|[^\s'"\\])+/g)].map(([word]) =>
    word.replace(
      /'([^']*)'|"((?:\\.|[^"\\])*)"|\\(.)/g,
      (_, single, double, escaped) => single ?? escaped ?? (double as string).replace(/\\(.)/g, "$1"),
    ),
  )

const BUILT_IN = ["-h", "--help"]

const optionNames = (option: OptionInfo): string[] =>
  option.flags.split(/[ ,|]+/).filter((part) => part.startsWith("-"))

/** Why an example would not parse against the command it is listed under, or undefined when it would. */
const faultOf = (
  example: string,
  command: CommandInfo,
  ancestors: readonly CommandInfo[],
  document: CommandsDocument,
) => {
  const words = exampleWords(example)
  if (words[0] !== document.cli) return `does not start with "${document.cli}"`
  const known = [document.global_options, ...ancestors.map((one) => one.options), command.options].flat()
  const find = (word: string) => known.find((option) => optionNames(option).includes(word))

  const option = (at: number): number | string => {
    const word = words[at] ?? ""
    const [name = word, inline] = word.startsWith("--") ? word.split(/=(.*)/s) : [word]
    if (BUILT_IN.includes(name)) return at + 1
    const found = find(name)
    if (!found) return `${command.path.join(" ")} has no option ${name}`
    if (!found.takes_value || inline !== undefined) return at + 1
    const optional = /\[[^\]]*\]/.test(found.flags)
    if (/\.\.\.[>\]]/.test(found.flags)) {
      let next = at + 1
      while (next < words.length && !words[next]?.startsWith("-")) next += 1
      return next
    }
    if (optional) return words[at + 1] === undefined || words[at + 1]?.startsWith("-") ? at + 1 : at + 2
    return words[at + 1] === undefined ? `${name} needs a value` : at + 2
  }

  let at = 1
  let profile = false
  while (words[at] !== command.path[0]) {
    if (at >= words.length) return `does not run ${command.path.join(" ")}`
    if (words[at]?.startsWith("-")) {
      const next = option(at)
      if (typeof next === "string") return next
      at = next
    } else if (!profile) {
      profile = true
      at += 1
    } else return `does not run ${command.path.join(" ")}`
  }
  for (const segment of command.path) {
    if (words[at] !== segment) return `does not run ${command.path.join(" ")}`
    at += 1
  }
  let positional = 0
  let rest = false
  while (at < words.length) {
    const word = words[at] ?? ""
    if (!rest && word === "--") {
      rest = true
      at += 1
    } else if (!rest && word.startsWith("-") && word.length > 1) {
      const next = option(at)
      if (typeof next === "string") return next
      at = next
    } else {
      positional += 1
      at += 1
    }
  }
  const required = command.arguments.filter((argument) => argument.required).length
  const variadic = command.arguments.some((argument) => argument.variadic)
  if (positional < required)
    return `${command.path.join(" ")} needs ${required} argument(s); the example gives ${positional}`
  if (!variadic && positional > command.arguments.length)
    return `${command.path.join(" ")} takes ${command.arguments.length} argument(s); the example gives ${positional}`
  return undefined
}

const withAncestors = (commands: readonly CommandInfo[], above: readonly CommandInfo[] = []) =>
  commands.flatMap((one): [CommandInfo, readonly CommandInfo[]][] => [
    [one, above],
    ...withAncestors(one.commands, [...above, one]),
  ])

/** `--since-time` → a time window, `--before-id` → `id`, `--kind` → `kind`: what a flag would filter by. */
const filteredBy = (flag: string): { field?: string; window?: "time" | "id" } => {
  const bare = flag.replace(/^--/, "").replace(/^(before|after|since|until)-/, "")
  if (bare === "time") return { window: "time" }
  if (bare === "id") return { window: "id" }
  return { field: bare.replace(/-(time|id|n)$/, "").replaceAll("-", "_") }
}

/** An entity's fields: the query's, then its registered schema's properties; `time` for a date-time. */
const entityFields = (command: CommandInfo, context: LintContext): Map<string, string> => {
  const fields = new Map<string, string>((command.query?.fields ?? []).map((field) => [field.name, field.type]))
  const entity = command.output?.entity ?? command.query?.entity
  const schema = entity === undefined ? undefined : context.schemas?.[entity]
  const properties = isObject(schema) && isObject(schema.properties) ? schema.properties : {}
  for (const [name, property] of Object.entries(properties))
    if (!fields.has(name)) fields.set(name, isObject(property) && property.format === "date-time" ? "time" : "other")
  return fields
}

const optionsOf = (document: CommandsDocument) => [
  ...document.global_options.map((option) => ({ option, target: longName(option.flags) })),
  ...walk(document.commands)
    .filter((command) => command.origin === "handwritten")
    .flatMap((command) =>
      command.options.map((option) => ({ option, target: `${label(command)} ${longName(option.flags)}` })),
    ),
]

const CHECKS: Record<string, Check> = {
  "unknown-verb": (document, vocabulary) => {
    const allowed = new Set([
      ...vocabulary.verbs.map((entry) => entry.word),
      ...vocabulary.views.map((entry) => entry.word),
    ])
    const roots = new Set(vocabulary.roots.map((entry) => entry.word))
    const searchable = new Set([...vocabulary.nouns.map((entry) => entry.word), SEARCH_EVERYTHING])
    const searchLeaf = (command: CommandInfo) => command.path.at(-2) === SEARCH_ROOT && searchable.has(command.name)
    return handwrittenLeaves(document)
      .filter((command) => !allowed.has(command.name) && !(command.path.length === 1 && roots.has(command.name)))
      .filter((command) => !searchLeaf(command))
      .map((command) => ({
        target: label(command),
        message: `"${command.name}" is not a verb or view noun in the vocabulary`,
      }))
  },
  "unknown-resource": (document, vocabulary) => {
    const nouns = new Set(vocabulary.nouns.map((entry) => entry.word))
    const roots = new Set(vocabulary.roots.map((entry) => entry.word))
    const verbs = new Set(vocabulary.verbs.map((entry) => entry.word))
    return walk(document.commands)
      .filter((command) => command.commands.length > 0 && command.origin === "handwritten")
      .filter((command) => !nouns.has(command.name) && !roots.has(command.name))
      .map((command) => ({
        target: label(command),
        message: verbs.has(command.name)
          ? `the group "${command.name}" is named with a verb; a group is a resource`
          : `"${command.name}" is not a resource in the vocabulary: a plural, a registered singular, or a root word`,
      }))
  },
  "flag-two-meanings": (document, vocabulary) => {
    const registered = new Map(
      vocabulary.flags.map((flag) => [flag.name, flag.value?.slice(1, -1).toLowerCase() ?? "switch"]),
    )
    const uses = new Map<string, Map<string, string[]>>()
    const note = (option: OptionInfo, where: string) => {
      const name = longName(option.flags)
      const kinds = uses.get(name) ?? new Map<string, string[]>()
      kinds.set(kindOf(option), [...(kinds.get(kindOf(option)) ?? []), where])
      uses.set(name, kinds)
    }
    for (const option of document.global_options) note(option, "every command")
    for (const command of walk(document.commands))
      if (command.origin === "handwritten") for (const option of command.options) note(option, label(command))
    const found: Omit<Violation, "rule">[] = []
    for (const [name, kinds] of [...uses].sort(([a], [b]) => byText(a, b))) {
      const expected = registered.get(name)
      const off = expected === undefined ? [] : [...kinds.keys()].filter((kind) => kind !== expected)
      if (kinds.size < 2 && off.length === 0) continue
      const described = [...kinds]
        .map(([kind, where]) => `${kind === "switch" ? "a switch" : `<${kind}>`} in ${where.slice(0, 3).join(", ")}`)
        .join("; ")
      found.push({
        target: name,
        message:
          expected === undefined
            ? `${name} has ${kinds.size} meanings: ${described}`
            : `${name} is ${expected === "switch" ? "a switch" : `<${expected}>`} in the vocabulary, but: ${described}`,
      })
    }
    return found
  },
  "missing-command-help": (document) =>
    walk(document.commands)
      .filter((command) => summaryOf(command) === "")
      .map((command) => ({ target: label(command), message: "no summary or description" })),
  "command-help-too-long": (document) =>
    walk(document.commands)
      .filter((command) => command.origin === "handwritten" && summaryOf(command).length > SUMMARY_LIMIT)
      .map((command) => ({
        target: label(command),
        message: `summary is ${summaryOf(command).length} characters; at most ${SUMMARY_LIMIT}`,
      })),
  "command-example-count": (document) =>
    handwrittenLeaves(document)
      .filter((command) => {
        const count = command.examples?.length ?? 0
        return count < EXAMPLES_MIN || count > EXAMPLES_MAX
      })
      .map((command) => ({
        target: label(command),
        message: `${command.examples?.length ?? 0} examples; give ${EXAMPLES_MIN} to ${EXAMPLES_MAX}`,
      })),
  "faulty-help-example-parameters": (document) =>
    withAncestors(document.commands)
      .filter(([command]) => command.commands.length === 0 && command.origin === "handwritten")
      .flatMap(([command, ancestors]) =>
        (command.examples ?? []).flatMap((example) => {
          const fault = faultOf(example, command, ancestors, document)
          return fault === undefined ? [] : [{ target: `${label(command)}: ${example}`, message: fault }]
        }),
      ),
  "missing-argument-help": (document) =>
    walk(document.commands).flatMap((command) =>
      command.arguments
        .filter((argument) => argument.description.trim() === "")
        .map((argument) => ({ target: `${label(command)} <${argument.name}>`, message: "argument not described" })),
    ),
  "key-casing": (document, _vocabulary, context) => {
    const { [LOG_ATTRIBUTES]: _camelCase, ...own } = context.schemas ?? {}
    const schemas = { ...baseSchemas(), ...own }
    return [
      ...Object.entries(schemas).flatMap(([name, schema]) =>
        schemaKeys(schema, "").map(([key, path]) => ({ key, target: `schema ${name}: ${path}` })),
      ),
      ...documentKeys(context.raw ?? document, "").map(([key, path]) => ({ key, target: `commands --json: ${path}` })),
    ]
      .filter(({ key }) => !SNAKE_CASE.test(key))
      .map(({ key, target }) => ({ target, message: `"${key}" is not snake_case` }))
  },
  "filter-flag": (document, vocabulary, context) => {
    const roles = new Map(vocabulary.flags.map((flag) => [flag.name, flag.role]))
    return walk(document.commands)
      .filter((command) => command.origin === "handwritten" && !command.mutates && (command.query || command.output))
      .flatMap((command) => {
        const fields = entityFields(command, context)
        return command.options
          .filter((option) => roles.get(longName(option.flags)) !== "scope")
          .flatMap((option) => {
            const { field, window } = filteredBy(longName(option.flags))
            const hit =
              window === "time"
                ? [...fields].find(([, type]) => type === "time")?.[0]
                : window === "id"
                  ? fields.has("id")
                    ? "id"
                    : undefined
                  : field !== undefined && fields.has(field)
                    ? field
                    : undefined
            return hit === undefined
              ? []
              : [{ target: `${label(command)} ${longName(option.flags)}`, message: `filters by ${hit}; use the query` }]
          })
      })
  },
  "option-role": (document, vocabulary) => {
    const roles = new Set(vocabulary.flags.map((flag) => flag.name))
    return optionsOf(document)
      .filter(({ option }) => !roles.has(longName(option.flags)))
      .map(({ target, option }) => ({ target, message: `${longName(option.flags)} has no role in the vocabulary` }))
  },
  "list-without-query": (document) =>
    handwrittenLeaves(document)
      .filter((command) => command.name === "list" && command.output !== undefined && command.query === undefined)
      .map((command) => ({
        target: label(command),
        message: `answers with ${command.output?.entity} but takes no query`,
      })),
  "query-example": (document) =>
    walk(document.commands).flatMap((command) =>
      command.query
        ? exampleProblems(command.query).map(({ field, problem }) => ({
            target: `${label(command)} ${field}`,
            message: problem,
          }))
        : [],
    ),
  "missing-option-help": (document) => [
    ...document.global_options
      .filter((option) => option.description.trim() === "")
      .map((option) => ({ target: longName(option.flags), message: "global option not described" })),
    ...walk(document.commands).flatMap((command) =>
      command.options
        .filter((option) => option.description.trim() === "")
        .map((option) => ({ target: `${label(command)} ${longName(option.flags)}`, message: "option not described" })),
    ),
  ],
  "log-attribute-key": (_document, _vocabulary, context) => {
    const schema = context.schemas?.[LOG_ATTRIBUTES] ?? logAttributesJsonSchema()
    return schemaKeys(schema, "")
      .filter(([key]) => isContentKey(key))
      .map(([key, path]) => ({
        target: `schema ${LOG_ATTRIBUTES}: ${path}`,
        message: `"${key}" names content or a secret, which no log may carry`,
      }))
  },
}

export const lintRuleIds = (): string[] => Object.keys(CHECKS)

/** Every violation, one per rule and target, sorted. Generated commands keep the names of the API they mirror. */
export const lintCommands = (
  document: CommandsDocument,
  vocabulary: Vocabulary,
  rules: readonly LintRule[] = LINT_RULES,
  context: LintContext = {},
): Violation[] => {
  const seen = new Set<string>()
  return rules.flatMap((rule) => {
    const check = CHECKS[rule.id]
    if (!check) throw new Error(`lint rule "${rule.id}" has no check`)
    return check(document, vocabulary, context)
      .filter(({ target }) => !seen.has(`${rule.id} ${target}`) && seen.add(`${rule.id} ${target}`))
      .map((found) => ({ rule: rule.id, ...found }))
      .sort((a, b) => byText(a.target, b.target))
  })
}

export interface Judgement {
  /** Not in the baseline and not overridden: these fail the run. */
  fresh: Violation[]
  baselined: number
  overridden: number
  /** Baseline or override entries with no violation left: the list only shrinks, so these fail too. */
  stale: { rule: string; target: string; in: "baseline" | "overrides" }[]
  /** Rule ids named by a baseline file or an override that no rule has. */
  unknownRules: string[]
  overBudget: boolean
}

export const judge = (
  violations: readonly Violation[],
  baseline: Readonly<Record<string, readonly string[]>>,
  overrides: readonly Override[],
  budget: number,
  rules: readonly LintRule[] = LINT_RULES,
): Judgement => {
  const ids = new Set(rules.map((rule) => rule.id))
  const key = (rule: string, target: string) => `${rule} ${target}`
  const overridden = new Set(overrides.map((entry) => key(entry.rule, entry.target)))
  const baselined = new Set(Object.entries(baseline).flatMap(([rule, targets]) => targets.map((t) => key(rule, t))))
  const found = new Set(violations.map((violation) => key(violation.rule, violation.target)))
  const open = violations.filter((violation) => !overridden.has(key(violation.rule, violation.target)))
  const fresh = open.filter((violation) => !baselined.has(key(violation.rule, violation.target)))

  return {
    fresh,
    baselined: open.length - fresh.length,
    overridden: violations.length - open.length,
    stale: [
      ...Object.entries(baseline).flatMap(([rule, targets]) =>
        targets
          .filter((target) => !found.has(key(rule, target)) || overridden.has(key(rule, target)))
          .map((target) => ({ rule, target, in: "baseline" as const })),
      ),
      ...overrides
        .filter((entry) => !found.has(key(entry.rule, entry.target)))
        .map((entry) => ({ rule: entry.rule, target: entry.target, in: "overrides" as const })),
    ],
    unknownRules: [
      ...new Set([...Object.keys(baseline), ...overrides.map((entry) => entry.rule)].filter((id) => !ids.has(id))),
    ].sort(),
    overBudget: overrides.length > budget,
  }
}

/** What `--write-baseline` writes: per rule, the targets no override covers. A rule with none gets no file. */
export const baselineOf = (
  violations: readonly Violation[],
  overrides: readonly Override[],
  rules: readonly LintRule[] = LINT_RULES,
): Record<string, string[]> => {
  const overridden = new Set(overrides.map((entry) => `${entry.rule} ${entry.target}`))
  return Object.fromEntries(
    rules.map((rule) => [
      rule.id,
      violations
        .filter((violation) => violation.rule === rule.id && !overridden.has(`${violation.rule} ${violation.target}`))
        .map((violation) => violation.target)
        .sort(),
    ]),
  )
}
