import { singleLine } from "../sanitize.js"

/** What a tool says about itself to `wcat`, from `wcat-<name> --wcat-describe` or the tool's own metadata. */
export interface WcatTool {
  /** The name in `wcat <name>`, and the short command: `tg`. */
  command: string
  version: string
  /** One line: what the tool reads or does. */
  description: string
  /** The tool's documentation page. */
  docs?: string
}

/** Format of the `--wcat-describe` answer; a later format adds keys and keeps these. */
export const DESCRIBE_FORMAT = 1

export interface DescribeAnswer {
  wcat_describe: number
  name: string
  version: string
  description: string
  docs_url?: string
}

export const describeAnswer = (tool: WcatTool): DescribeAnswer => ({
  wcat_describe: DESCRIBE_FORMAT,
  name: tool.command,
  version: tool.version,
  description: tool.description,
  ...(tool.docs ? { docs_url: tool.docs } : {}),
})

const MAX_TEXT = 200

const clean = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? singleLine(value.trim()).slice(0, MAX_TEXT) : undefined

/** A `--wcat-describe` answer, or `undefined` for anything else: the program is listed either way. */
export const parseDescribe = (text: string): Omit<WcatTool, "command"> | undefined => {
  let answer: unknown
  try {
    answer = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof answer !== "object" || answer === null || !("wcat_describe" in answer)) return undefined
  const { version, description, docs_url: docs } = answer as Record<string, unknown>
  const url = clean(docs)
  return {
    version: clean(version) ?? "",
    description: clean(description) ?? "",
    ...(url && /^https?:\/\//.test(url) ? { docs: url } : {}),
  }
}
