import { singleLine } from "../sanitize.js"
import { DESCRIBE_MAX_BYTES } from "./names.js"

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
/** The format of a tool that ships `contracts/wirecat.json`: format 1's keys, its `desktop` and the file's hash. */
export const DESCRIBE_MANIFEST_FORMAT = 2

export interface DescribeAnswer {
  wcat_describe: number
  name: string
  version: string
  description: string
  docs_url?: string
  desktop?: unknown
  manifest_sha256?: string
}

/** The shipped manifest as `--wcat-describe` passes it on: its `desktop` object and the SHA-256 of its bytes. */
export interface ShippedManifest {
  desktop: unknown
  sha256: string
}

export const describeAnswer = (tool: WcatTool, manifest?: ShippedManifest): DescribeAnswer => {
  const answer = {
    wcat_describe: DESCRIBE_FORMAT,
    name: tool.command,
    version: tool.version,
    description: tool.description,
    ...(tool.docs ? { docs_url: tool.docs } : {}),
  }
  if (!manifest) return answer
  const full = {
    ...answer,
    wcat_describe: DESCRIBE_MANIFEST_FORMAT,
    desktop: manifest.desktop,
    manifest_sha256: manifest.sha256,
  }
  // `wcat` stops reading past the cap; format 1 still lists the tool, where a cut answer would list it bare.
  return Buffer.byteLength(`${JSON.stringify(full)}\n`) > DESCRIBE_MAX_BYTES ? answer : full
}

const MAX_TEXT = 200

const clean = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? singleLine(value.trim()).slice(0, MAX_TEXT) : undefined

export interface DescribedTool extends Omit<WcatTool, "command"> {
  /** Format 2 only: the SHA-256 of the tool's shipped `contracts/wirecat.json`. */
  manifestSha256?: string
}

/** A `--wcat-describe` answer of any format, or `undefined` for anything else: the program is listed either way. */
export const parseDescribe = (text: string): DescribedTool | undefined => {
  let answer: unknown
  try {
    answer = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof answer !== "object" || answer === null || !("wcat_describe" in answer)) return undefined
  const { version, description, docs_url: docs, manifest_sha256: sha } = answer as Record<string, unknown>
  const url = clean(docs)
  return {
    version: clean(version) ?? "",
    description: clean(description) ?? "",
    ...(url && /^https?:\/\//.test(url) ? { docs: url } : {}),
    ...(typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha) ? { manifestSha256: sha } : {}),
  }
}
