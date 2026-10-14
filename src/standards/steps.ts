import * as v from "valibot"
import { type Effects, writes } from "./effects.js"
import type { NextStep } from "./output.js"
import { dottedId, duplicates, fill, parseRegistry, SNAKE_CASE, text } from "./registry.js"

/** A step's command: a path such as `messages sync`, or `*` for the command that gave the answer (`page.next`). */
export const SAME_COMMAND = "*"

const commandPath = v.pipe(
  v.string(),
  v.regex(/^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/, "a command path such as `messages sync`"),
)

const stepSchema = v.union([
  v.strictObject({
    id: dottedId,
    kind: v.optional(v.literal("command"), "command"),
    command: v.union([v.literal(SAME_COMMAND), commandPath]),
    args: v.array(
      v.strictObject({
        name: v.pipe(v.string(), v.regex(SNAKE_CASE, "an argument or option name in snake_case")),
        required: v.boolean(),
      }),
    ),
    why: v.pipe(text, v.maxLength(120)),
  }),
  v.strictObject({ id: dottedId, kind: v.literal("user_action"), why: v.pipe(text, v.maxLength(120)) }),
])

export type StepDefinition = v.InferOutput<typeof stepSchema>

const argsOf = (step: StepDefinition) => (step.kind === "command" ? step.args : [])

export const defineSteps = (input: unknown): StepDefinition[] =>
  parseRegistry("steps", v.array(stepSchema), input, (steps) => [
    ...duplicates(steps.map((step) => step.id)).map((id) => `"${id}" is listed twice`),
    ...steps.flatMap((step) =>
      duplicates(argsOf(step).map((arg) => arg.name)).map((name) => `${step.id}: argument "${name}" is listed twice`),
    ),
  ])

/** What a step's command is, read from the live command tree (`stepTargets` in `/commands`). */
export interface StepTarget {
  effects?: Effects
  /** Its arguments and options in snake_case. */
  names: readonly string[]
}

export interface StepInput {
  args?: Readonly<Record<string, unknown>>
  /** Values for the `{placeholders}` of `why` that are not arguments. */
  values?: Readonly<Record<string, string | number>>
  /** Required when the step's command is `*`. */
  command?: string
  /** Looks a command path up; without it, or for a path it does not know, the step is never safe to run unasked. */
  targets?: (command: string) => StepTarget | undefined
}

// A value that would bind to an option: a scalar on one line. A paragraph read out of a message is not one.
const BINDS = /^[^\p{Cc}\u2028\u2029]*$/u
const binds = (value: unknown): boolean =>
  typeof value === "number" || typeof value === "boolean" || (typeof value === "string" && BINDS.test(value))

/**
 * One `next` entry from its definition: checks the arguments against the definition and, when `targets` knows the
 * command, against the options it really takes; fills `why`. Build steps only from state the CLI owns — ids, counts,
 * cursors — never from text a message, email or document carried.
 */
export const stepOf = (definition: StepDefinition, input: StepInput = {}): NextStep => {
  const args = input.args ?? {}
  if (definition.kind === "user_action")
    return {
      kind: "user_action",
      step: definition.id,
      why: fill(definition.why, { ...input.values }),
      safe_to_auto_execute: false,
    }
  const command = definition.command === SAME_COMMAND ? input.command : definition.command
  if (!command) throw new Error(`${definition.id}: the step runs the same command, so pass the command`)
  const known = new Set(definition.args.map((arg) => arg.name))
  // A step that reruns the answer's command carries that command's own arguments too.
  if (definition.command !== SAME_COMMAND)
    for (const name of Object.keys(args))
      if (!known.has(name)) throw new Error(`${definition.id}: no argument "${name}"`)
  for (const arg of definition.args)
    if (arg.required && args[arg.name] === undefined)
      throw new Error(`${definition.id}: argument "${arg.name}" is required`)
  for (const [name, value] of Object.entries(args))
    if (!(Array.isArray(value) ? value.every(binds) : binds(value)))
      throw new Error(`${definition.id}: "${name}" is not a value an option takes`)
  const target = input.targets?.(command)
  if (input.targets && !target) throw new Error(`${definition.id}: no command "${command}"`)
  const names = new Set(target?.names ?? [])
  if (target)
    for (const name of Object.keys(args))
      if (!names.has(name)) throw new Error(`${definition.id}: "${command}" takes no "${name}"`)
  const scalars = Object.fromEntries(
    Object.entries(args).filter((entry): entry is [string, string | number] =>
      ["string", "number"].includes(typeof entry[1]),
    ),
  )
  return {
    kind: "command",
    step: definition.id,
    command,
    args: { ...args },
    why: fill(definition.why, { ...scalars, ...input.values }),
    safe_to_auto_execute: target?.effects !== undefined && !writes(target.effects),
  }
}

/** The steps every CLI has; each package adds its own with `defineSteps`. */
export const STEPS: StepDefinition[] = defineSteps([
  {
    id: "page.next",
    command: SAME_COMMAND,
    args: [
      { name: "cursor", required: false },
      { name: "page", required: false },
      { name: "limit", required: false },
    ],
    why: "{shown} shown, more exist",
  },
])
