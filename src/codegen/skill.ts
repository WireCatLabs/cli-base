/**
 * The API part of a CLI's agent skill: `references/api.md`, a short index, and `references/api/api-<group>.md`, one
 * file per tag of the spec, so an agent loads only the group it needs (`<cli> skill show api-<group>`). Each command,
 * its usage, arguments and flags come from the built program's command tree, as `--help` prints them; the manifest
 * adds only what the API says: the HTTP call, the effect, sign-in scopes, permission keys and paging.
 */
import type { CommandInfo, OptionInfo } from "../commands/registry.js"
import { flatten } from "../commands/registry.js"
import type { ManifestOperation } from "./manifest.js"
import type { GeneratedArtifact, Pagination } from "./model.js"
import { kebab } from "./names.js"
import { CodegenError } from "./pipeline.js"

export interface ApiSkillOptions {
  /** The skill's folder, beside its SKILL.md: `skills/notion-cli`. */
  folder: string
  /** The service, for the headings: `Notion`. */
  service: string
  operations: readonly ManifestOperation[]
  /** The SKILL.md beside these files, as text: an agent reaches them only through its link to `references/api.md`. */
  skill: string
  /** `describeProgram(createProgram())`: the generated commands carry `api_operation`. */
  commands: readonly CommandInfo[]
  banner: string
}

export const API_SKILL_INDEX = "references/api.md"
export const API_SKILL_GROUPS = "references/api"

/** Vendor text becomes instructions an agent follows: its first line only, with nothing that changes the Markdown. */
const text = (value: string | undefined): string =>
  (value ?? "")
    .split("\n")[0]
    ?.trim()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "\\|")
    .replaceAll("`", "'") ?? ""

const code = (value: string) => `\`${value.replaceAll("`", "'").replaceAll("|", "\\|")}\``

const pages = (pagination: Pagination): string => {
  const sent = (parameter: { in: string; name: string }) => `${code(parameter.name)} (${parameter.in})`
  const limit = "limit" in pagination && pagination.limit ? `; page size in ${sent(pagination.limit)}` : ""
  const items = pagination.items ? `; items in ${code(pagination.items)}` : ""
  switch (pagination.style) {
    case "cursor":
      return `cursor: send ${sent(pagination.cursor)}, read the next one from ${code(pagination.next)}${items}${limit}`
    case "offset":
      return `offset: send ${sent(pagination.offset)}${items}${limit}`
    case "page":
      return `page number: send ${sent(pagination.page)}${items}${limit}`
    case "link":
      return `the answer's ${code(pagination.next)} is the next page's address${items}`
  }
}

const flagRow = (option: OptionInfo) =>
  `| ${code(option.flags)} | ${option.mandatory ? "yes" : "no"} | ${text(option.description)} |`

const section = (operation: ManifestOperation, command: CommandInfo): string[] => {
  const call =
    operation.binding.kind === "http" ? `${operation.binding.method} ${operation.binding.path}` : operation.binding.name
  const scopes = (operation.security ?? []).map((requirement) =>
    Object.entries(requirement)
      .map(([scheme, list]) => (list.length > 0 ? `${scheme} (${list.join(", ")})` : scheme))
      .join(" and "),
  )
  const lines = [
    `## ${code(command.usage)}`,
    "",
    text(operation.summary ?? command.summary ?? command.description) || operation.id,
    "",
    `- Call: ${code(call)}, effect: ${operation.effect}${operation.deprecated ? ", deprecated" : ""}`,
  ]
  if (scopes.length > 0) lines.push(`- Sign-in: ${scopes.map(text).join("; or ")}`)
  if (operation.permissions && operation.permissions.length > 0)
    lines.push(`- Permission keys: ${operation.permissions.map((permission) => code(permission.key)).join(", ")}`)
  if (operation.pagination) lines.push(`- Pages: ${pages(operation.pagination)}`)
  if (operation.request?.schema)
    lines.push(`- Body: ${code(operation.request.schema)}${operation.request.required ? ", required" : ""}`)
  if (command.arguments.length > 0) {
    lines.push("", "| Argument | Required | What |", "|---|---|---|")
    for (const argument of command.arguments)
      lines.push(`| ${code(argument.name)} | ${argument.required ? "yes" : "no"} | ${text(argument.description)} |`)
  }
  if (command.options.length > 0) {
    lines.push("", "| Flag | Required | What |", "|---|---|---|")
    for (const option of command.options) lines.push(flagRow(option))
  }
  return [...lines, ""]
}

/**
 * Throws `CodegenError` when an operation has no command or a generated command names no operation: a flag is
 * never taken from anywhere but the command tree. Sorted, and with no version or date, so `generate:check` holds.
 */
export const apiSkillFiles = (options: ApiSkillOptions): GeneratedArtifact[] => {
  const generated = flatten(options.commands).filter((command) => command.api_operation)
  const byOperation = new Map(generated.map((command) => [command.api_operation, command]))
  const ids = new Set(options.operations.map((operation) => operation.id))
  const problems = [
    ...(options.skill.includes(API_SKILL_INDEX) ? [] : [`SKILL.md does not link ${API_SKILL_INDEX}`]),
    ...options.operations
      .filter((operation) => !byOperation.has(operation.id))
      .map((operation) => `operation ${operation.id} has no command in the program`),
    ...generated
      .filter((command) => !ids.has(command.api_operation ?? ""))
      .map((command) => `${command.path.join(" ")} names operation ${command.api_operation}, not in the manifest`),
  ]

  const groups = new Map<string, { tag: string; operations: ManifestOperation[] }>()
  for (const operation of options.operations) {
    const tag = operation.tags[0] ?? "Other"
    const name = kebab(tag) || "other"
    const group = groups.get(name)
    if (group && group.tag !== tag) problems.push(`tags "${group.tag}" and "${tag}" both make the file api-${name}.md`)
    else if (group) group.operations.push(operation)
    else groups.set(name, { tag, operations: [operation] })
  }
  if (problems.length > 0) throw new CodegenError(problems)

  const parentPaths = new Set(generated.map((command) => command.path.slice(0, -1).join(" ")))
  const parents = flatten(options.commands).filter((command) => parentPaths.has(command.path.join(" ")))
  const names = [...groups.keys()].sort()
  const commandOf = (operation: ManifestOperation) => byOperation.get(operation.id) as CommandInfo
  const program = generated[0]?.usage.split(" ")[0] ?? ""

  const index = [
    `<!-- ${options.banner} -->`,
    "",
    `# ${text(options.service)} API`,
    "",
    `Every operation of the ${text(options.service)} API this CLI offers is a command of its own. Read only the group`,
    `you need: ${code(`${program} skill show api-<group>`)} prints it, as does the file \`api/api-<group>.md\` beside`,
    "this one. Each command lists its usage and flags as `--help` prints them.",
    "",
    "Effects: `read` changes nothing; `write` changes the service; `destructive` deletes or overwrites there.",
    "",
  ]
  for (const parent of parents) {
    if (parent.options.length === 0) continue
    index.push(`Options of ${code(parent.usage)} for every command under it:`, "", "| Flag | Required | What |")
    index.push("|---|---|---|")
    for (const option of parent.options) index.push(flagRow(option))
    index.push("")
  }
  index.push("| Group | Read with | Commands | read | write | destructive |", "|---|---|---|---|---|---|")
  for (const name of names) {
    const { tag, operations } = groups.get(name) as { tag: string; operations: ManifestOperation[] }
    const count = (effect: string) => operations.filter((operation) => operation.effect === effect).length
    index.push(
      `| ${text(tag)} | ${code(`${program} skill show api-${name}`)} | ${operations.length} | ${count("read")} | ` +
        `${count("write")} | ${count("destructive")} |`,
    )
  }

  const files = names.map((name) => {
    const { tag, operations } = groups.get(name) as { tag: string; operations: ManifestOperation[] }
    const sorted = [...operations].sort((one, other) => commandOf(one).usage.localeCompare(commandOf(other).usage))
    return {
      path: `${options.folder}/${API_SKILL_GROUPS}/api-${name}.md`,
      content: [
        `<!-- ${options.banner} -->`,
        "",
        `# ${text(options.service)} API: ${text(tag)}`,
        "",
        ...sorted.flatMap((operation) => section(operation, commandOf(operation))),
      ]
        .join("\n")
        .replace(/\n+$/, "\n"),
    }
  })
  return [{ path: `${options.folder}/${API_SKILL_INDEX}`, content: `${index.join("\n")}\n` }, ...files]
}
