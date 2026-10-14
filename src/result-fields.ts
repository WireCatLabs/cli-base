import { CliError } from "./errors.js"

const forbidden = new Set(["__proto__", "prototype", "constructor"])
const validate = (paths: readonly string[]): void => {
  if (
    paths.length === 0 ||
    paths.length > 128 ||
    paths.some(
      (path) =>
        path.length > 256 ||
        !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/.test(path) ||
        path.split(".").some((part) => forbidden.has(part)),
    )
  )
    throw new CliError(
      "validation_error",
      "field selection takes comma-separated field paths, for example id,source.title",
    )
}

export const fieldsOf = (value: string): string[] => {
  const paths = value.split(",").map((one) => one.trim())
  validate(paths)
  return [...new Set(paths)]
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const retained = new Set(["operation_id", "page", "next", "missing", "meta", "coverage"])
const itemPaths = (paths: readonly string[]): string[] =>
  paths.map((path) => (path.startsWith("items.") ? path.slice(6) : path))

const select = (value: unknown, paths: readonly string[]): unknown => {
  if (Array.isArray(value)) return value.map((item) => select(item, paths))
  if (!object(value)) return value
  const result: Record<string, unknown> = {}
  const groups = new Map<string, string[]>()
  for (const path of paths) {
    const [key, ...rest] = path.split(".")
    if (!key) continue
    const children = groups.get(key) ?? []
    children.push(rest.join("."))
    groups.set(key, children)
  }
  for (const [key, children] of groups) {
    if (!Object.hasOwn(value, key) || value[key] === undefined) continue
    const found = value[key]
    if (children.includes("")) result[key] = found
    else if (object(found) || Array.isArray(found)) {
      const selected = select(found, children)
      if (Array.isArray(selected) || (object(selected) && Object.keys(selected).length > 0)) result[key] = selected
    }
  }
  for (const key of retained) if (Object.hasOwn(value, key)) result[key] = value[key]
  return result
}

const project = (value: unknown, fields: readonly string[]): unknown => {
  if (Array.isArray(value)) return value.map((item) => select(item, itemPaths(fields)))
  if (object(value) && Object.hasOwn(value, "item") && Object.hasOwn(value, "meta"))
    return { ...value, item: project(value.item, fields) }
  if (object(value) && Array.isArray(value.items))
    return { ...value, items: value.items.map((item) => select(item, itemPaths(fields))) }
  return select(value, object(value) && !Object.hasOwn(value, "items") ? itemPaths(fields) : fields)
}

/** Projects payload paths through objects and arrays, retaining result coverage and continuation. */
export const projectFields = (value: unknown, fields: readonly string[]): unknown => {
  validate(fields)
  return project(value, fields)
}
