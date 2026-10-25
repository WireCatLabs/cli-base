# New CLI

## Scope

How to start a new WireCat CLI: one command that copies the template, the four steps that need a person, and the
checks that prove the result. A new CLI is done when every check in "Done when" passes.

This page is a checklist, not a rule page: it assigns no rule ids. The rules are on the area pages it links. How to
read a rule and which rule wins are in the [index](README.md). The parts of cli-base and cli-core the template is
built on are on the [Kit surface](kit-surface.md) page.

## Start with the template

```sh
npx @wirecat/cli-template new cal-cli --command cal --package @wirecat/cal-cli --owner WireCatLabs \
  --category calendar --content-lang en,ru --sign-in oauth --api official-client --filters time,person,text \
  --never-store tokens,secret-links --untrusted names,links
```

In a terminal, `new` asks for every answer you leave out. Without a terminal, a missing answer is an error that lists
the choices. Nothing is guessed.

| Flag | What it sets | Choices |
|---|---|---|
| `<name>-cli` | the repository folder | any name |
| `--command` | the command word people type | one word |
| `--package` | the npm package name | a scoped name, such as `@wirecat/cal-cli` |
| `--owner` | the GitHub owner of the repository | an owner |
| `--category` | what the CLI reads | `messenger`, `mail`, `notes`, `files`, `calendar`, `meetings` |
| `--content-lang` | the languages of the content | a list, such as `en,ru` |
| `--sign-in` | how the CLI signs in | `oauth`, `token`, `session`, `none` |
| `--api` | what the service offers | `official-client`, `official-docs`, `unofficial` |
| `--filters` | how people narrow a list | a list of `time`, `person`, `container`, `text`, `status` |
| `--never-store` | what the store must never keep | a list of `tokens`, `codes`, `secret-links`, `content` |
| `--untrusted` | what text comes from other people | a list of `messages`, `files`, `links`, `names`, or `none` |

Every choice question also takes `other:<your answer>`.

`new` copies the template of its own package version into `<name>-cli/`, renames the command word everywhere, runs
`git init`, records the template version in `template.json`, writes `docs/dev/DESIGN.md` from your answers and names
a reference CLI for your category in `AGENTS.md`. It does not install packages, push, create the repository or
publish. Then:

```sh
cd cal-cli && pnpm install && pnpm ci:quick
git add -A && git commit -m "chore: start from @wirecat/cli-template"
```

Give the agent `docs/dev/DESIGN.md` next. Every example passes a profile explicitly, such as `cal personal doctor`.
The reference CLI is the one to compare with when a step is unclear.

The copy already holds every file this handbook asks for: the required root commands (`commands`, `doctor`,
`skill show`, `skill install`, `mcp`, `upgrade`) and `config` from cli-core, the MCP server with a tool for every
command, writes included, the community presets in `config/wirecat/`, the TypeScript, Biome and vitest setup,
`contracts/`, `lint/`, the test matrix, the user pages, `CHANGELOG.md`, `SECURITY.md`, `bin/release`, and the
`pr.yml`, `ci.yml`, `main.yml`, `standards.yml`, `changelog-guard.yml`, `monthly.yml` and `release.yml` workflows.
The rules they keep are on the area pages: [Commands](commands.md), [MCP](mcp.md), [Accounts](accounts.md),
[Permissions](permissions.md), [Testing](testing.md), [Documents](docs.md), [Releases](releases.md) and [CI](ci.md).

Later template changes come in with `npx @wirecat/cli-template upgrade`, file by file: apply, replace, skip or diff.
See [Kit surface](kit-surface.md#how-your-cli-stays-current).

## Four steps that need a person

`new` prints these at the end.

1. **Create the repository** under the owner, with a ruleset on the default branch: no deletion, no force push,
   changes only through a pull request, required status checks, and no bypass. Add the ruleset after the first
   commit is on `main`, since a pull request rule leaves an empty repository no way to get one, and the required
   check names exist only once CI has run. See [Releases](releases.md).
2. **Set npm trusted publishing** for the new package, naming `release.yml`, and add any secrets the CI needs. See
   [WC-REL-11](releases.md#wc-rel-11--publish-from-github-actions-with-npm-trusted-publishing).
3. **Pick a monthly cron day** no other repository uses. `.github/workflows/monthly.yml` holds a placeholder that CI
   rejects. See [CI](ci.md).
4. **WireCat CLIs only: join the shared lists.** A pull request to cli-base's `PARITY_GROUPS` (at least the `all`
   group, which compares the shared root commands), a line in cli-core's `WIRECAT_TOOLS` and a line in cli-docs'
   `tools.json`. A messenger also joins cli-core's `parity.json`. A CLI outside WireCatLabs keeps its parity groups
   in its own repository and runs `cli-dev audit --groups <file>`. See [Testing](testing.md).

## Done when

All of these pass on `main`, before the first release:

- `pnpm standards:check`
- `pnpm typecheck`, `pnpm lint` and `pnpm test` with coverage
- `cli-dev lint` against the built CLI
- `cli-dev audit --for <cli> --lint <cli>=lint` with no new finding, run with the command trees of the CLIs in
  the same parity groups. `--lint` judges the CLI's lint rules by its own `lint/` folder. What it shares with the
  other CLIs is judged by cli-base's `audit/baseline`; the pull request that adds the CLI to a parity group adds its
  shared findings there
- `pnpm contracts:check`
- `cli-dev test-matrix --check`
- `pnpm docs:check`, with `--pages`, and the CLI's `generate:check`
- the changelog guard on a pull request
- `pnpm release:check`

The last test is a fresh agent. Give it only this handbook's [index](README.md) and the new repository, and ask it to
audit the CLI. Every gap it lists is either a gap in the CLI, to fix before the first release, or a hole in the
handbook, to fix here.
