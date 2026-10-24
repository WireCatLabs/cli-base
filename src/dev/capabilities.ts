import * as v from "valibot"
import type { CommandsDocument } from "../commands/index.js"
import { kindOf, longName, walk } from "./lint.js"

const availability = v.union([v.literal("all"), v.array(v.string())])
const entry = v.object({
  in: availability,
  reason: v.optional(v.string()),
  planned: v.optional(v.record(v.string(), v.string())),
})
const option = v.union([v.literal("all"), entry])
const manifestSchema = v.object({
  clis: v.array(v.string()),
  commands: v.record(v.string(), v.object({ ...entry.entries, options: v.optional(v.record(v.string(), option)) })),
})
export type Capabilities = v.InferOutput<typeof manifestSchema>
export const readCapabilities = (input: unknown): Capabilities => v.parse(manifestSchema, input)

/** Presence differences are accepted only when every observed value matches a declared provider capability. */
export const capabilityDifference = (
  target: string,
  clis: readonly string[],
  documents: readonly CommandsDocument[],
  manifest: Capabilities,
): boolean => {
  if (clis.some((cli) => !manifest.clis.includes(cli))) return false
  const words = target.slice(target.indexOf(" ") + 1)
  if (words.endsWith(": presence")) {
    const path = words.slice(0, -10)
    const ancestor = path
      .split(" ")
      .map((_, index, parts) => parts.slice(0, parts.length - index).join(" "))
      .find((name) => manifest.commands[name] !== undefined)
    const policy = ancestor ? manifest.commands[ancestor] : undefined
    if (!policy || policy.in === "all" || (!policy.reason && !policy.planned)) return false
    return clis.every(
      (cli) =>
        walk(documents.find((doc) => doc.cli === cli)?.commands ?? []).some(
          (command) => command.path.join(" ") === path,
        ) === policy.in.includes(cli),
    )
  }
  const flagAt = words.lastIndexOf(" --")
  if (flagAt < 0) return false
  const path = words.slice(0, flagAt),
    flag = words.slice(flagAt + 1)
  const policy = manifest.commands[path]?.options?.[flag]
  if (!policy || policy === "all" || policy.in === "all" || (!policy.reason && !policy.planned)) return false
  const signatures = new Set<string>()
  const matches = clis.every((cli) => {
    const doc = documents.find((doc) => doc.cli === cli)
    const command = walk(doc?.commands ?? []).find((command) => command.path.join(" ") === path)
    const option = [...(doc?.global_options ?? []), ...(command?.options ?? [])].find(
      (option) => longName(option.flags) === flag,
    )
    if (option) signatures.add(kindOf(option))
    return (option !== undefined) === policy.in.includes(cli)
  })
  return matches && signatures.size <= 1
}
