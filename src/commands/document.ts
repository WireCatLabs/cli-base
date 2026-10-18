import type { Command } from "commander"
import * as v from "valibot"
import { EXIT_CODES, GENERIC_FAILURE } from "../exit-codes.js"
import { FIELD_TYPES, QUERY_BACKENDS } from "../query/fields.js"
import { effectsSchema } from "../standards/effects.js"
import { issuesOf, jsonSchemaOf } from "../standards/registry.js"
import { type CommandInfo, describeOptions, describeProgram, type OptionInfo } from "./registry.js"

const argumentInfoSchema = v.object({
  name: v.string(),
  required: v.boolean(),
  variadic: v.boolean(),
  description: v.string(),
  choices: v.optional(v.array(v.string())),
  default: v.optional(v.unknown()),
})

const optionInfoSchema = v.object({
  flags: v.string(),
  description: v.string(),
  takes_value: v.boolean(),
  mandatory: v.boolean(),
  choices: v.optional(v.array(v.string())),
  default: v.optional(v.unknown()),
  env: v.optional(v.string()),
  conflicts: v.optional(v.array(v.string())),
  implies: v.optional(v.record(v.string(), v.unknown())),
  mcp: v.optional(v.literal(false)),
})

const fieldInfoSchema = v.object({
  name: v.string(),
  type: v.picklist(FIELD_TYPES),
  operators: v.array(v.picklist(["term", "phrase", "wildcard", "regex", "range"])),
  values: v.optional(v.array(v.string())),
  example: v.string(),
  relation: v.optional(v.string()),
  native: v.optional(v.boolean()),
  placement: v.optional(v.literal("and")),
})

const commandInfoSchema: v.GenericSchema<CommandInfo> = v.object({
  path: v.array(v.string()),
  name: v.string(),
  summary: v.optional(v.string()),
  description: v.string(),
  usage: v.string(),
  origin: v.picklist(["handwritten", "generated"]),
  api_operation: v.optional(v.string()),
  effects: v.optional(effectsSchema),
  state: v.optional(v.picklist(["beta", "deprecated"])),
  partial: v.optional(v.boolean()),
  lifetime: v.optional(v.picklist(["persistent", "interactive"])),
  reaches: v.optional(v.literal("other_service")),
  mcp: v.optional(v.literal(false)),
  offline: v.optional(v.literal(false)),
  cooperative: v.optional(v.boolean()),
  examples: v.optional(v.array(v.string())),
  output: v.optional(v.object({ entity: v.string(), view: v.optional(v.string()) })),
  query: v.optional(
    v.object({
      entity: v.string(),
      backend: v.picklist(QUERY_BACKENDS),
      fields: v.array(fieldInfoSchema),
      defaults: v.optional(v.array(v.string())),
    }),
  ),
  runnable: v.optional(v.literal(true)),
  arguments: v.array(argumentInfoSchema),
  options: v.array(optionInfoSchema),
  commands: v.array(v.lazy(() => commandInfoSchema)),
})

/**
 * What `<cli> commands --json` prints, in every CLI on cli-base. `scope` and `inherited_options` are
 * there only when one command path was asked for. Nothing else at the top: `cli-dev lint` refuses it.
 */
export const commandsDocumentSchema = v.strictObject({
  cli: v.pipe(v.string(), v.nonEmpty()),
  version: v.pipe(v.string(), v.nonEmpty()),
  /** The major version of the JSON the CLI's commands print. */
  contract: v.pipe(v.number(), v.integer(), v.minValue(0)),
  description: v.string(),
  global_options: v.array(optionInfoSchema),
  scope: v.optional(v.array(v.string())),
  inherited_options: v.optional(v.array(v.object({ path: v.array(v.string()), options: v.array(optionInfoSchema) }))),
  commands: v.array(commandInfoSchema),
  exit_codes: v.record(v.string(), v.pipe(v.number(), v.integer())),
})

export interface CommandsDocument {
  cli: string
  version: string
  contract: number
  description: string
  global_options: OptionInfo[]
  scope?: string[]
  inherited_options?: { path: string[]; options: OptionInfo[] }[]
  commands: CommandInfo[]
  exit_codes: Record<string, number>
}

export const commandsDocumentJsonSchema = () => jsonSchemaOf(commandsDocumentSchema, { command: commandInfoSchema })

export const parseCommandsDocument = (
  value: unknown,
): { document: CommandsDocument; problems?: undefined } | { document?: undefined; problems: string[] } => {
  const parsed = v.safeParse(commandsDocumentSchema, value)
  return parsed.success ? { document: parsed.output as CommandsDocument } : { problems: issuesOf(parsed.issues) }
}

export interface CommandsDocumentAbout {
  cli: string
  version: string
  contract: number
}

/** The whole tree; a CLI that answers `commands <path>` adds `scope` and `inherited_options` itself. */
export const commandsDocument = (root: Command, about: CommandsDocumentAbout): CommandsDocument => ({
  cli: about.cli,
  version: about.version,
  contract: about.contract,
  description: root.description(),
  global_options: describeOptions(root),
  commands: describeProgram(root),
  exit_codes: { ok: 0, internal_error: GENERIC_FAILURE, ...EXIT_CODES },
})
