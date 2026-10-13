import * as v from "valibot"
import type { NextStep } from "./output.js"
import { dottedId, duplicates, fill, parseRegistry, SNAKE_CASE, text } from "./registry.js"

/** A step's command: a path such as `messages sync`, or `*` for the command that gave the answer (`page.next`). */
export const SAME_COMMAND = "*"

const stepSchema = v.strictObject({
  id: dottedId,
  command: v.union([
    v.literal(SAME_COMMAND),
    v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/, "a command path such as `messages sync`")),
  ]),
  args: v.array(
    v.strictObject({
      name: v.pipe(v.string(), v.regex(SNAKE_CASE, "an argument or option name in snake_case")),
      required: v.boolean(),
    }),
  ),
  why: v.pipe(text, v.maxLength(120)),
})

export type StepDefinition = v.InferOutput<typeof stepSchema>

export const defineSteps = (input: unknown): StepDefinition[] =>
  parseRegistry("steps", v.array(stepSchema), input, (steps) => [
    ...duplicates(steps.map((step) => step.id)).map((id) => `"${id}" is listed twice`),
    ...steps.flatMap((step) =>
      duplicates(step.args.map((arg) => arg.name)).map((name) => `${step.id}: argument "${name}" is listed twice`),
    ),
  ])

export interface StepInput {
  args: Readonly<Record<string, unknown>>
  /** Values for the `{placeholders}` of `why` that are not arguments. */
  values?: Readonly<Record<string, string | number>>
  /** Required when the step's command is `*`. */
  command?: string
}

/** One `next` entry from its definition: checks the arguments and fills `why`. */
export const stepOf = (definition: StepDefinition, input: StepInput): NextStep => {
  const command = definition.command === SAME_COMMAND ? input.command : definition.command
  if (!command) throw new Error(`${definition.id}: the step runs the same command, so pass the command`)
  const known = new Set(definition.args.map((arg) => arg.name))
  // A step that reruns the answer's command carries that command's own arguments too.
  if (definition.command !== SAME_COMMAND)
    for (const name of Object.keys(input.args))
      if (!known.has(name)) throw new Error(`${definition.id}: no argument "${name}"`)
  for (const arg of definition.args)
    if (arg.required && input.args[arg.name] === undefined)
      throw new Error(`${definition.id}: argument "${arg.name}" is required`)
  const scalars = Object.fromEntries(
    Object.entries(input.args).filter((entry): entry is [string, string | number] =>
      ["string", "number"].includes(typeof entry[1]),
    ),
  )
  return {
    step: definition.id,
    command,
    args: { ...input.args },
    why: fill(definition.why, { ...scalars, ...input.values }),
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
