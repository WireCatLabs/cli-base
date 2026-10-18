/**
 * The command registry: the whole command tree of a CLI as data, however each command came to be.
 *
 * It walks the live Commander tree rather than a list written by hand, so a command built in a
 * loop from a catalog shows up exactly like one written in a file. What the tree cannot say — where
 * a command came from, whether it changes anything, whether it is on its way out — is attached with
 * `annotate`, and to an option with `annotateOption`.
 *
 * Behind its own entry point for the same reason `/http` is: Commander is only a type here, and the
 * root of this package stays free of any command-line framework.
 */
import type { Command } from "commander"
import { CliError } from "../errors.js"

export {
  type CommandsDocument,
  type CommandsDocumentAbout,
  commandsDocument,
  commandsDocumentJsonSchema,
  commandsDocumentSchema,
  parseCommandsDocument,
} from "./document.js"
export {
  COMMANDS_PAGE_LABELS,
  type CommandsPage,
  type CommandsPageLabels,
  type CommandsPageText,
  commandsPage,
} from "./page.js"
export * from "./registry.js"

/**
 * Refuses a command path that arrived as one argument — `"projects add" --help`, what a zsh loop over
 * `$c` passes. Commander settles `--help` for an unknown word before any hook runs and prints the root
 * help, so the words are checked before parsing. Pass the words after a leading profile, if any.
 */
export const refuseJoinedPath = (root: Command, args: readonly string[]): void => {
  let command = root
  const path: string[] = []
  for (const arg of args) {
    if (arg.startsWith("-")) return
    const [first = "", ...rest] = arg.trim().split(/\s+/)
    const next = command.commands.find((child) => child.name() === first || child.aliases().includes(first))
    if (next === undefined) return
    if (rest.length > 0)
      throw new CliError(
        "validation_error",
        `"${arg}" was given as one argument; run: ${[root.name(), ...path, first, ...rest].join(" ")}`,
      )
    path.push(first)
    command = next
  }
}
