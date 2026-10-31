/**
 * `cli-dev lint`'s checks for joining `wcat` (WC-CMD-29). They warn and never fail the run: every CLI still installs
 * its short name until it moves to `wcat-<name>`, and the warning becomes a failure once they have.
 */
import { parseDescribe } from "../wcat/describe.js"
import { DESCRIBE_FLAG, PROGRAM_PREFIX, RESERVED_NAMES, TOOL_NAME } from "../wcat/names.js"

export interface WcatWarning {
  rule: "wcat-bin-name" | "wcat-describe"
  target: string
  message: string
}

const WIRECAT_SCOPE = "@wirecat/"

/** The commands a `package.json` installs: its `"bin"` keys, or the package's own name for a `"bin"` string. */
const binNames = (pkg: { name?: unknown; bin?: unknown }): string[] => {
  if (typeof pkg.bin === "string") return typeof pkg.name === "string" ? [pkg.name.replace(/^@[^/]+\//, "")] : []
  return typeof pkg.bin === "object" && pkg.bin !== null ? Object.keys(pkg.bin) : []
}

/** Each command is `wcat-<name>`, and a package outside `@wirecat/` takes no reserved name. */
export const binNameWarnings = (pkg: { name?: unknown; bin?: unknown }): WcatWarning[] =>
  binNames(pkg).flatMap((command): WcatWarning[] => {
    const target = `package.json "bin" ${command}`
    if (!command.startsWith(PROGRAM_PREFIX))
      return [
        {
          rule: "wcat-bin-name",
          target,
          message: `install the command as ${PROGRAM_PREFIX}${command}, so no other program on PATH has its name`,
        },
      ]
    const name = command.slice(PROGRAM_PREFIX.length)
    if (!TOOL_NAME.test(name))
      return [{ rule: "wcat-bin-name", target, message: "the name after wcat- is lower-case letters, digits and -" }]
    const ours = typeof pkg.name === "string" && pkg.name.startsWith(WIRECAT_SCOPE)
    if (!ours && RESERVED_NAMES.includes(name))
      return [{ rule: "wcat-bin-name", target, message: `${name} is reserved for WireCat's own tools or wcat itself` }]
    return []
  })

/** The built CLI answers `--wcat-describe` with its JSON description. */
export const describeWarnings = (answer: { status: number | null; stdout: unknown }): WcatWarning[] =>
  answer.status === 0 && parseDescribe(String(answer.stdout))
    ? []
    : [
        {
          rule: "wcat-describe",
          target: DESCRIBE_FLAG,
          message: `the CLI does not answer ${DESCRIBE_FLAG}: call wcatStart from @wirecat/cli-base/wcat/start first in its bin`,
        },
      ]
