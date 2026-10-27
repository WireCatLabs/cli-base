# Kit surface

## Scope

These are the parts of cli-core and cli-base that the template is built on. A CLI started with
`npx @wirecat/cli-template new` imports them from its first commit. When one of them changes in a way your code must
follow, the changelog gives the steps, and the template is already updated, so `npx @wirecat/cli-template upgrade`
brings the change into your CLI.

This page is a reference, not a rule page: it assigns no rule ids. How to start a CLI from the template is on the
[New CLI](new-cli.md) page. How a release is made is on the [Releases](releases.md) page.

## What the template imports

The list is what the template's `src/` and `scripts/` import today, type imports, re-exports and imports loaded on
demand included. `kit/` imports
nothing from either package.

| Package and path | Exports |
|---|---|
| `@wirecat/cli-base` | `catchCrashes`, `CliError`, `configFilePath`, `mcpErrorResult`, `resolvePaths` |
| `@wirecat/cli-base/commands` | `annotate`, `CommandInfo`, `COMMANDS_PAGE_LABELS` (in `scripts/`), `commandsPage` (in `scripts/`), `describeOptions` (in `scripts/`), `describeProgram` |
| `@wirecat/cli-base/codegen` | `writeArtifacts` (in `scripts/`) |
| `@wirecat/cli-base/release` | `DocsRules`, `JOURNAL_IDS`, `markdownFiles`, `packContents` (all in `scripts/`) |
| `@wirecat/cli-core/cli` | `AppIdentity`, `changesAuthorityAt`, `commandHelpMarkdown` (in `scripts/`), `commandsCommand`, `configCommand`, `Configuration`, `createProgram`, `environmentOf`, `GlobalFlags`, `httpTokenFile`, `itemOf`, `LOCAL_READ`, `LOCAL_WRITE`, `MCP_HTTP_DEFAULT_PORT`, `mcpServerCommand`, `outputFor`, `privateFiles`, `profileFree`, `ProgramDefinition`, `ProgramOptions`, `readOnlyLockOf`, `refuseUnderReadOnly`, `REMOTE_WRITE`, `renderAnswer`, `rootOf`, `run`, `RunOptions`, `runsCommand`, `settingsFor`, `skillCommand`, `upgradeCommand` |
| `@wirecat/cli-core/mcp` | `httpLockFile`, `MCP_PATH`, `McpCommand`, `portOf`, `publicUrlOf`, `registerCommands`, `revokeAll`, `runCommandForAgent`, `serveOverHttp`, `toolsFromCommands` |
| `@wirecat/cli-core/sends` | `Level` |
| `@wirecat/cli-core/update` | `appUpdate` |
| `@wirecat/cli-core/testing` | `ARGV_LOG`, `argvLogSetup` |

The template's config files also reach cli-base: `tsconfig.json` and `kit/tsconfig.json` extend
`tsconfig.base.json`, `tsconfig.test.json` and `tsconfig.scripts.json` extend the files of those names, `vitest.config.ts`
loads `@wirecat/cli-base/testing/setup`, and `.vale.ini` reads the styles in `config/vale`.

## When one of them changes

A change that makes a CLI change its code for one of these exports ships with two things:

1. **A migration note in the changelog**, under "Changed — may break callers": what to change in your code, step by
   step. See [Documents](docs.md) for the changelog's shape.
2. **A green cli-template job before the pull request merges.** cli-base
   ([`template.yml`](https://github.com/WireCatLabs/cli-base/blob/main/.github/workflows/template.yml)) and cli-core
   (the `template` job in [`parity.yml`](https://github.com/WireCatLabs/cli-core/blob/main/.github/workflows/parity.yml))
   build the template against each pull request, so the template is updated in the same change, and `upgrade` has
   the new version to bring.

## How your CLI stays current

- **Exact versions.** The template depends on `@wirecat/cli-base` and `@wirecat/cli-core` at exact versions, the
  normal setup for every WireCat CLI. A CLI made from it starts with the same pins.
- **Dependabot.** The template's `dependabot.yml` checks `@wirecat/*` every day and opens one pull request for the
  shared packages within a day of a release. Its CI shows whether anything else needs to change.
- **`upgrade`.** In your CLI, with a clean git working tree:

  ```sh
  npx @wirecat/cli-template upgrade
  ```

  For each template file that changed since your version, it asks: apply (merge the change into your file, keeping
  your edits), replace, skip or diff. Without a terminal, `--apply`, `--replace` or `--skip` answers for every file,
  and `--dry-run` lists what each file would get. Then re-run community's `adopt-standards.py` for `config/wirecat/`.
