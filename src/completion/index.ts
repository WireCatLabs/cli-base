/**
 * Shell completion over the command registry: which word may come next, as data.
 *
 * It speaks the protocol of the shell scripts `@bomb.sh/tab` generates — the shell runs
 * `<cli> complete -- <words>` and reads `value<TAB>description` lines ending in `:<directive>` —
 * so a CLI prints those scripts with tab and answers the requests with this. Nothing here reads a
 * terminal, a file or the network: the words come in, the suggestions go out, and where values come
 * from (a local cache, a config file) is the CLI's business, handed in as `sources`.
 */
import type { ArgumentInfo, CommandInfo, OptionInfo } from "../commands/index.js"

export interface Suggestion {
  value: string
  description: string
}

/** Values for one argument or option. Called on every Tab, so it must be cheap and must not connect anywhere. */
export type Values = () => readonly (string | Suggestion)[]

export interface CompletionSources {
  /** By argument name, as registered: `chat`, `person`. */
  arguments?: Readonly<Record<string, Values>>
  /** By long option name without dashes: `chat` for `--chat <id>`. */
  options?: Readonly<Record<string, Values>>
  /** Offered alongside the top-level commands — a profile name that may come first, say. */
  firstWord?: Values
}

export interface CompletionRequest {
  commands: readonly CommandInfo[]
  globalOptions?: readonly OptionInfo[]
  /** Everything after `complete --`; the last word is the one being typed, `""` for a fresh one. */
  words: readonly string[]
  sources?: CompletionSources
}

/** Tells the shell not to fall back to file names when nothing matched. */
export const NO_FILE_COMPLETION = 4

export const suggest = ({ commands, globalOptions = [], words, sources = {} }: CompletionRequest): Suggestion[] => {
  const typed = words.at(-1) ?? ""
  const before = words.slice(0, -1)

  let level: readonly CommandInfo[] = commands
  let current: CommandInfo | undefined
  let positional = 0
  let pending: OptionInfo | undefined

  for (const word of before) {
    if (pending) {
      pending = undefined
      continue
    }
    if (word.startsWith("-")) {
      const option = findOption(word, current, globalOptions)
      if (option?.takes_value && !word.includes("=")) pending = option
      continue
    }
    const child = level.find((command) => command.name === word)
    if (child) {
      current = child
      level = child.commands
      positional = 0
    } else {
      positional += 1
    }
  }

  const candidates = pending
    ? optionValues(pending, sources)
    : typed.startsWith("-")
      ? typed.includes("=")
        ? valuesAfterEquals(typed, current, globalOptions, sources)
        : optionNames(current, globalOptions)
      : [
          ...level.filter((command) => command.state !== "deprecated").map(asSuggestion),
          ...(current ? argumentValues(current.arguments, positional, sources) : []),
          ...(current ? [] : resolve(sources.firstWord)),
        ]

  const unique = new Map(candidates.map((candidate) => [candidate.value, candidate]))
  return [...unique.values()].filter(({ value }) => value.startsWith(typed))
}

/** The answer in the form the shell script reads. */
export const formatSuggestions = (suggestions: readonly Suggestion[]): string =>
  [...suggestions.map(({ value, description }) => `${value}\t${description}`), `:${NO_FILE_COMPLETION}`].join("\n")

const asSuggestion = (command: CommandInfo): Suggestion => ({
  value: command.name,
  description: command.summary ?? command.description,
})

const longName = (option: OptionInfo): string | undefined => option.flags.match(/--([\w-]+)/)?.[1]

const findOption = (word: string, current: CommandInfo | undefined, globals: readonly OptionInfo[]) => {
  const name = word.replace(/^-+/, "").split("=")[0]
  const matches = (option: OptionInfo) => longName(option) === name || option.flags.split(/[ ,]+/).includes(`-${name}`)
  return [...(current?.options ?? []), ...globals].find(matches)
}

const optionNames = (current: CommandInfo | undefined, globals: readonly OptionInfo[]): Suggestion[] =>
  [...(current?.options ?? []), ...globals].flatMap((option) => {
    const name = longName(option)
    return name ? [{ value: `--${name}`, description: option.description }] : []
  })

/** `--kind <dialog|group|channel>`: Commander does not know these as choices, but the flags say them. */
const inlineChoices = (flags: string): string[] => flags.match(/<([^>]*\|[^>]*)>/)?.[1]?.split("|") ?? []

const optionValues = (option: OptionInfo, sources: CompletionSources): Suggestion[] => {
  const name = longName(option)
  return [
    ...[...(option.choices ?? []), ...inlineChoices(option.flags)].map((value) => ({ value, description: "" })),
    ...resolve(name ? sources.options?.[name] : undefined),
  ]
}

const valuesAfterEquals = (
  typed: string,
  current: CommandInfo | undefined,
  globals: readonly OptionInfo[],
  sources: CompletionSources,
): Suggestion[] => {
  const [flag] = typed.split("=")
  const option = findOption(flag ?? "", current, globals)
  if (!option?.takes_value) return []
  return optionValues(option, sources).map(({ value, description }) => ({ value: `${flag}=${value}`, description }))
}

const argumentValues = (args: readonly ArgumentInfo[], position: number, sources: CompletionSources): Suggestion[] => {
  const argument = args[position] ?? (args.at(-1)?.variadic ? args.at(-1) : undefined)
  if (!argument) return []
  return [
    ...(argument.choices ?? []).map((value) => ({ value, description: "" })),
    ...resolve(sources.arguments?.[argument.name]),
  ]
}

const resolve = (values: Values | undefined): Suggestion[] =>
  (values?.() ?? []).map((value) => (typeof value === "string" ? { value, description: "" } : value))
