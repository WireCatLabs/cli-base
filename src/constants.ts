import { fileURLToPath } from "node:url"
import * as v from "valibot"
import { loadConfigFile } from "./config.js"

/** cli-base's own layer, the first one every program passes to `loadConstants`. */
export const BASE_CONSTANTS = new URL("../constants.json", import.meta.url)

/** What cli-base's layer holds; a layer above extends it with `v.object({ ...baseConstantsSchema.entries, … })`. */
export const baseConstantsSchema = v.object({})

type Layer = Record<string, unknown>

const LayerSchema = v.record(v.string(), v.unknown())

const isPlainObject = (value: unknown): value is Layer =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const merge = (into: Layer, from: Layer, file: string, setBy: Map<string, string>, prefix = ""): Layer => {
  const out: Layer = { ...into }
  for (const [key, value] of Object.entries(from)) {
    const path = prefix ? `${prefix}.${key}` : key
    const current = out[key]
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = merge(current, value, file, setBy, path)
    } else {
      out[key] = value
      setBy.set(path, file)
    }
  }
  return out
}

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

const fileOf = (path: string, setBy: Map<string, string>, files: readonly string[]): string => {
  for (let at = path.split("."); at.length > 0; at = at.slice(0, -1)) {
    const file = setBy.get(at.join("."))
    if (file) return `set in ${file}`
  }
  return `not set in ${files.join(", ")}`
}

/**
 * Values that ship inside the packages — never the owner's settings. Each layer is a JSON file, base first; a file
 * that does not exist is an empty layer, so a tool without constants of its own passes its URL anyway. Plain objects
 * merge key by key and a later layer wins; an array or a scalar replaces what was below it. The result is checked
 * against the caller's schema and frozen.
 */
export const loadConstants = <TSchema extends v.GenericSchema>(
  layers: readonly URL[],
  schema: TSchema,
): v.InferOutput<TSchema> => {
  const files = layers.map((layer) => fileURLToPath(layer))
  const setBy = new Map<string, string>()
  let merged: Layer = {}
  for (const file of files) {
    merged = merge(
      merged,
      loadConfigFile(file, LayerSchema, () => ({})),
      file,
      setBy,
    )
  }

  const result = v.safeParse(schema, merged)
  if (!result.success) {
    const problems = result.issues.map((issue) => {
      const path = v.getDotPath(issue) ?? "(root)"
      return `${path}: ${issue.message} (${fileOf(path, setBy, files)})`
    })
    throw new Error(`the packaged constants are not valid:\n  ${problems.join("\n  ")}`)
  }
  return deepFreeze(result.output)
}
