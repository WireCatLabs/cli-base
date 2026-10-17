# New CLI

<!-- cspell:ignore rumdl whatsapp -->

## Scope

The steps to start a new WireCat CLI and the checks that prove each step. Every item names the check that proves
it, or the handbook page whose rules it keeps. A new CLI is done when every check in "Done when" passes.

This page is a checklist, not a rule page: it assigns no rule ids. The rules are on the area pages it links. How to
read a rule and which rule wins are in the [index](README.md).

whatsapp-cli is the worked example: it has every file below. Compare with it when a step is unclear.

## Start from the shared standards

1. **Create the repository** under `WireCatLabs`, with a `main` branch that takes changes only through pull requests.
   Proved by: the repository ruleset. See [Releases](releases.md).
2. **Install the community presets.** From a reviewed checkout of
   [WireCatLabs/community](https://github.com/WireCatLabs/community):

   ```sh
   python3 scripts/adopt-standards.py ../whatsapp-cli
   ```

   This is the command that was run for whatsapp-cli; use your new repository's folder instead.

   The installer copies the Biome base, the grit plugins, cspell, markdownlint, rumdl, lefthook and the release lock
   helper into `config/wirecat/`, pins the tool versions, records the file hashes and writes the `standards.yml`
   workflow. Commit the result with the lockfile. Proved by: `pnpm standards:check`, run by `standards.yml`.
3. **Copy community's `monthly.yml` template** into `.github/workflows/`, and set its cron to a day no other
   repository uses. Proved by: the workflow appears in the Actions tab. See [CI](ci.md).

## Toolchain

1. **Depend on the shared packages at exact versions.** `@wirecat/cli-base` always, at 0.41.0 or later: it is the
   first version that ships this handbook and the `cli-dev` lint and audit that the checks below run.
   `@wirecat/cli-core` as well when the CLI is a messenger or uses the shared store, search, MCP server or send guard.
   What cli-core already does, the new CLI does not do again. See [Architecture](architecture.md).
2. **Extend the shared TypeScript configuration**: `@wirecat/cli-base/tsconfig.base.json` for `src/`,
   `tsconfig.test.json` for tests and `tsconfig.scripts.json` for `scripts/`. Every directory with `.ts` files is in a
   project the build checks. Proved by: `pnpm typecheck`.
3. **Extend the community Biome base** (`./config/wirecat/biome.base.json`) in the root `biome.json`, and add the
   project rules there: the 1,000-line file cap, import cycles and the layer imports. Proved by: `pnpm lint`. See
   [Toolchain](toolchain.md) and [Layout](layout.md).
4. **Add `ci:quick`**: typecheck, build and `cli-dev lint`. Proved by: the pull request CI. See [CI](ci.md).

## Commands every CLI has

1. **The required root commands.** `cli-dev audit` checks these six paths:
   - `commands`: the command tree as JSON, which agents and the audit read.
   - `doctor`: checks this machine and the profile, and says what to fix. `doctor --online` logs in once, never
     retries, sends nothing and marks nothing read (ruling NEED-288).
   - `skill show` and `skill install`: print and install the agent skill from `skills/<cli>/SKILL.md`, which the
     package ships. A missing or older skill is suggested on stderr at most once a day (ruling NEED-797).
   - `mcp`: the MCP server. Its tools are generated from the commands. See [MCP](mcp.md).
   - `upgrade`: updates the CLI.

   Proved by: `cli-dev audit --for <cli>`, rule `required-root`. A CLI on cli-core gets these from cli-core.
2. **`config`, where the CLI has settings.** cli-core provides it. It is not a required root. See
   [Accounts](accounts.md) for the profile, which is always explicit.
3. **Every command declares its effects and its lifetime**, and has a summary, described arguments and options, and
   examples. Proved by: `cli-dev lint`. See [Commands](commands.md), [Output](output.md) and
   [Lifecycle](lifecycle.md).
4. **Every write is gated by a permission.** See [Permissions](permissions.md).
5. **Add the CLI to the `all` parity group** in cli-base's `PARITY_GROUPS`. That group compares the shared root
   commands. Proved by: `cli-dev audit`, rule `same-path-contract`. A messenger also joins cli-core's `parity.json`,
   which `pnpm parity:check` reads. See [Testing](testing.md).

## Files to add

1. **`CLAUDE.md`** (and `AGENTS.md`, if the repository has one): a short file. It links this handbook at
   `node_modules/@wirecat/cli-base/docs/standards/README.md`, lists the CLI's "Local rules" below that link, and says
   where the private working folder lives. It does not restate handbook rules. See [Documents](docs.md).
2. **`lint/baseline/`** and `lint/overrides.json`: written once with `cli-dev lint --write-baseline`. The baseline only
   shrinks, and at most 10 overrides are allowed. Proved by: `cli-dev lint`.
3. **The test setup**: `vitest.config.ts` with a `setupFiles` line that points configuration, state, cache and the
   store at a temporary directory, and coverage thresholds. Proved by: `pnpm test`. See [Testing](testing.md) and
   [Store](store.md).
4. **`contracts/plan.json`** and its reviewed snapshots for `cli-contract` (cli-testing): help, discovery JSON, MCP
   tools and the no-leak check. Proved by: `pnpm contracts:check`. See [Testing](testing.md).
5. **The test matrix**: `docs/dev/test-matrix.md`, built by `cli-dev test-matrix`. Proved by:
   `cli-dev test-matrix --check`.
6. **The user pages**: `README.md`, `docs/meta.json` and the shared page set, with `docs/commands.md` generated from
   the program. Proved by: `cli-dev docs-check --pages` and the CLI's `generate:check`. See [Documents](docs.md).
7. **`CHANGELOG.md`** with `## Unreleased` at the top and the shared headings, and
   **`.github/workflows/changelog-guard.yml`** calling cli-base's `changelog-guard.yml` at a pinned commit. Proved by:
   `cli-dev docs-check` and the guard on the first pull request. See [Documents](docs.md).
8. **`SECURITY.md`**: how to report a vulnerability, linking cli-testing's security method. See
   [Security](security.md).
9. **`bin/release`**, **`release.yml`** and a release skill, copied from the nearest CLI. `bin/release` takes the
   release lock (WC-REL-3) and npm's trusted publisher settings name `release.yml`. A messenger CLI also waits two
   hours between releases and checks a signed release report (WC-REL-8, WC-REL-10). See [Releases](releases.md).
10. **`src/version.ts`** kept in step with `package.json`. Proved by: `pnpm version:check`.

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
