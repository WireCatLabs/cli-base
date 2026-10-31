/** WireCat's own tools: `wcat --help` names each one that is missing with the command that installs it. */
export const FIRST_PARTY_TOOLS: readonly { name: string; package?: string }[] = [
  { name: "tg", package: "@wirecat/tg-cli" },
  { name: "max", package: "@wirecat/max-cli" },
  { name: "wa", package: "@wirecat/whatsapp-cli" },
  { name: "zm", package: "@wirecat/zoom-cli" },
  { name: "drive", package: "@wirecat/drive-cli" },
  { name: "memo", package: "@wirecat/cli-memo" },
  { name: "mail", package: "@wirecat/mail-cli" },
  // memo reads email today; the name is held for a tool of its own.
  { name: "email" },
]

/** `wcat` answers these itself, so a `wcat-<name>` program can never take one over. */
export const BUILT_IN_COMMANDS = ["help", "version", "shortcuts", "doctor", "update", "upgrade", "app"] as const

/** Names a third-party CLI must not take: WireCat's tools, the built-in commands and `wcat` itself. */
export const RESERVED_NAMES: readonly string[] = [
  ...FIRST_PARTY_TOOLS.map((tool) => tool.name),
  ...BUILT_IN_COMMANDS,
  "wcat",
]

/** A tool name `wcat` runs: lower case, as a command word and a file name on every system. */
export const TOOL_NAME = /^[a-z][a-z0-9-]{0,39}$/

export const PROGRAM_PREFIX = "wcat-"

/** The first argument `wcat-<name> --wcat-describe` answers with its JSON description. */
export const DESCRIBE_FLAG = "--wcat-describe"

/** The first argument the `wcat` launcher passes, so the tool runs `wcat` instead of its own program. */
export const DISPATCH_FLAG = "--wcat-dispatch"
