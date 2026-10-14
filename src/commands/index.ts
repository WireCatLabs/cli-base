/**
 * The command registry: the whole command tree of a CLI as data, however each command came to be.
 *
 * It walks the live Commander tree rather than a list written by hand, so a command built in a
 * loop from a catalog shows up exactly like one written in a file. What the tree cannot say — where
 * a command came from, whether it changes anything, whether it is on its way out — is attached with
 * `annotate`.
 *
 * Behind its own entry point for the same reason `/http` is: Commander is only a type here, and the
 * root of this package stays free of any command-line framework.
 */
import type { Argument, Command, Option } from "commander"
import { CliError } from "../errors.js"
import type { QueryRegistry } from "../query/fields.js"
import { describeQuery, type QueryInfo } from "../query/registry.js"
import type { Effects } from "../standards/effects.js"
import type { StepTarget } from "../standards/steps.js"

export type Origin = "handwritten" | "generated"
export type CommandState = "beta" | "deprecated"

export interface CommandMeta {
  origin?: Origin
  /** The catalog operation a generated command was made from; not `operation_id`, which is one write attempt. */
  api_operation?: string
  /** What running it touches. Left out, it counts as a write: never retried, never run as a next step on its own. */
  effects?: Effects
  state?: CommandState
  /** The command may answer with `meta.complete: false` and still exit 0; without it a partial answer fails. */
  partial?: boolean
  examples?: readonly string[]
  /** The entity the command answers with, or one of its views. */
  output?: CommandOutput
  /** A list's query fields; the list takes them as its last argument, `[query...]`. */
  query?: QueryRegistry
}

export interface CommandOutput {
  entity: string
  view?: string
}

export interface ArgumentInfo {
  name: string
  required: boolean
  variadic: boolean
  description: string
  choices?: readonly string[]
  default?: unknown
}

export interface OptionInfo {
  flags: string
  description: string
  /** False for a plain switch like `--json`, so an agent knows not to look for a value. */
  takes_value: boolean
  /**
   * Whether the option itself must be given. Deliberately not Commander's `required`, which means
   * "takes a value when present" — reading that as "you must pass this" is the obvious misreading.
   */
  mandatory: boolean
  choices?: readonly string[]
  default?: unknown
  env?: string
  /** Options that may not be given together with this one. */
  conflicts?: readonly string[]
  /** Values this option sets on others when they are not given, by long flag. */
  implies?: Readonly<Record<string, unknown>>
}

export interface CommandInfo {
  /** What to pass to the CLI, already split: `["runs", "list"]`. */
  path: readonly string[]
  name: string
  summary?: string
  description: string
  usage: string
  origin: Origin
  api_operation?: string
  effects?: Effects
  state?: CommandState
  partial?: boolean
  examples?: readonly string[]
  output?: CommandOutput
  query?: QueryInfo
  arguments: readonly ArgumentInfo[]
  options: readonly OptionInfo[]
  commands: readonly CommandInfo[]
}

const labels = new WeakMap<Command, CommandMeta>()

/** Attaches what the tree cannot say. Repeated calls merge; the command is returned for chaining. */
export const annotate = <T extends Command>(command: T, meta: CommandMeta): T => {
  labels.set(command, { ...labels.get(command), ...meta })
  return command
}

export const metaOf = (command: Command): CommandMeta => labels.get(command) ?? {}

export const describeProgram = (root: Command): CommandInfo[] =>
  visible(root).map((child) => describe(child, root.name(), []))

export const describeOptions = (command: Command): OptionInfo[] =>
  command.options.filter((option) => !option.hidden).map(describeOption)

export const flatten = (commands: readonly CommandInfo[]): CommandInfo[] =>
  commands.flatMap((command) => [command, ...flatten(command.commands)])

const snake = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replaceAll("-", "_")

/**
 * What a next step may name, by command path (`messages list`): its effects, and the arguments and options it takes
 * in snake_case. Hand it to `stepOf` and `errorObjectOf` as `targets`.
 */
export const stepTargets = (root: Command): ((command: string) => StepTarget | undefined) => {
  const found = new Map<string, StepTarget>()
  // From the long flag, so `--no-input` is `no_input`: the name a step's args render back into the same flag.
  const optionName = (option: Option) => snake((option.long ?? option.attributeName()).replace(/^--/, ""))
  const visit = (command: Command, parents: readonly string[], above: readonly Option[]) => {
    const path = [...parents, command.name()]
    const options = [...above, ...command.options]
    const { effects } = metaOf(command)
    found.set(path.join(" "), {
      ...(effects ? { effects } : {}),
      names: [...command.registeredArguments.map((argument) => snake(argument.name())), ...options.map(optionName)],
    })
    for (const child of command.commands) visit(child, path, options)
  }
  for (const child of root.commands) visit(child, [], root.options)
  return (command) => found.get(command)
}

const describe = (command: Command, cli: string, parents: readonly string[]): CommandInfo => {
  const path = [...parents, command.name()]
  const args = command.registeredArguments.map(describeArgument)
  const options = describeOptions(command)
  const { origin = "handwritten", query, ...meta } = metaOf(command)

  const usage = [
    cli,
    ...path,
    ...args.map((argument) => (argument.required ? `<${argument.name}>` : `[${argument.name}]`)),
    options.length > 0 ? "[options]" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return {
    path,
    name: command.name(),
    ...(command.summary() ? { summary: command.summary() } : {}),
    description: command.description(),
    usage,
    origin,
    ...meta,
    ...(query ? { query: describeQuery(query) } : {}),
    arguments: args,
    options,
    commands: visible(command).map((child) => describe(child, cli, path)),
  }
}

// `addCommand(command, { hidden: true })` sets only this; Commander has no public getter for it.
const visible = (command: Command): Command[] =>
  command.commands.filter((child) => !(child as Command & { _hidden?: boolean })._hidden)

const describeArgument = (argument: Argument): ArgumentInfo => ({
  name: argument.name(),
  required: argument.required,
  variadic: argument.variadic,
  description: argument.description,
  ...(argument.argChoices ? { choices: argument.argChoices } : {}),
  ...(argument.defaultValue === undefined ? {} : { default: argument.defaultValue }),
})

// Commander 15 keeps these on every option but leaves them out of its type declarations.
type Related = { conflictsWith?: string[]; implied?: Record<string, unknown> }

// Commander keys `implies` by attribute name (`dryRun`); the document names the flag, as everywhere else.
const impliesOf = (implied: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(implied).map(([name, value]) => [
      `--${name.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`)}`,
      value,
    ]),
  )

const describeOption = (option: Option): OptionInfo => {
  const { conflictsWith = [], implied } = option as Option & Related
  return {
    flags: option.flags,
    description: option.description,
    takes_value: option.required || option.optional,
    mandatory: option.mandatory,
    ...(option.argChoices ? { choices: option.argChoices } : {}),
    ...(option.defaultValue === undefined ? {} : { default: option.defaultValue }),
    ...(option.envVar ? { env: option.envVar } : {}),
    ...(conflictsWith.length > 0 ? { conflicts: conflictsWith } : {}),
    ...(implied ? { implies: impliesOf(implied) } : {}),
  }
}

export {
  type CommandsDocument,
  type CommandsDocumentAbout,
  commandsDocument,
  commandsDocumentJsonSchema,
  commandsDocumentSchema,
  parseCommandsDocument,
} from "./document.js"
export {
  COMMANDS_PAGE_LABELS,
  type CommandsPage,
  type CommandsPageLabels,
  type CommandsPageText,
  commandsPage,
} from "./page.js"

/**
 * Refuses a command path that arrived as one argument — `"projects add" --help`, what a zsh loop over
 * `$c` passes. Commander settles `--help` for an unknown word before any hook runs and prints the root
 * help, so the words are checked before parsing. Pass the words after a leading profile, if any.
 */
export const refuseJoinedPath = (root: Command, args: readonly string[]): void => {
  let command = root
  const path: string[] = []
  for (const arg of args) {
    if (arg.startsWith("-")) return
    const [first = "", ...rest] = arg.trim().split(/\s+/)
    const next = command.commands.find((child) => child.name() === first || child.aliases().includes(first))
    if (next === undefined) return
    if (rest.length > 0)
      throw new CliError(
        "validation_error",
        `"${arg}" was given as one argument; run: ${[root.name(), ...path, first, ...rest].join(" ")}`,
      )
    path.push(first)
    command = next
  }
}
