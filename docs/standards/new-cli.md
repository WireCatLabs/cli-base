# New CLI

## Scope

How to start a new WireCat CLI: one command that copies the template, the four steps that need a person, and the
checks that prove the result. A new CLI is done when every check in "Done when" passes.

This page is a checklist, not a rule page: it assigns no rule ids. The rules are on the area pages it links. How to
read a rule and which rule wins are in the [index](README.md). The parts of cli-base and cli-core the template is
built on are on the [Kit surface](kit-surface.md) page.

## Start with the template

```sh
npx @wirecat/cli-template new gcal-cli --command gcal --package @wirecat/gcal-cli --owner WireCatLabs \
  --category calendar --content-lang en,ru --sign-in oauth --api official-client --filters time,person,text \
  --never-store tokens,secret-links --untrusted names,links
```

In a terminal, `new` asks for every answer you leave out. Without a terminal, a missing answer is an error that lists
the choices. Nothing is guessed.

| Flag | What it sets | Choices |
|---|---|---|
| `<name>-cli` | the repository folder | any name |
| `--command` | the command word people type | one word |
| `--package` | the npm package name | a scoped name, such as `@wirecat/gcal-cli` |
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
cd gcal-cli && pnpm install && pnpm ci:quick
git add -A && git commit -m "chore: start from @wirecat/cli-template"
```

Give the agent `docs/dev/DESIGN.md` next. Every example passes a profile explicitly, such as `gcal personal doctor`.
The reference CLI is the one to compare with when a step is unclear.

The copy already holds every file this handbook asks for: the required root commands (`commands`, `doctor`,
`skill show`, `skill install`, `mcp`, `upgrade`) and `config` from cli-core, the run log and its `runs` commands
([WC-LIFE-15](lifecycle.md#wc-life-15--keep-a-run-log-through-cli-core-and-read-it-back-with-runs)), the MCP server with a tool for every
command, writes included, the community presets in `config/wirecat/`, the TypeScript, Biome and vitest setup,
`contracts/`, `lint/`, the test matrix, the user pages, `CHANGELOG.md`, `SECURITY.md`, `bin/release`, and the
`pr.yml`, `ci.yml`, `main.yml`, `standards.yml`, `changelog-guard.yml`, `monthly.yml` and `release.yml` workflows.
The rules they keep are on the area pages: [Commands](commands.md), [MCP](mcp.md), [Accounts](accounts.md),
[Permissions](permissions.md), [Testing](testing.md), [Documents](docs.md), [Releases](releases.md) and [CI](ci.md).

Later template changes come in with `npx @wirecat/cli-template upgrade`, file by file: apply, replace, skip or diff.
See [Kit surface](kit-surface.md#how-your-cli-stays-current).

The template's `template.json` splits the copy in two. A **seed** (`DESIGN.md`, `CLAUDE.md`, `README.md`, the user
pages, `src/`) is the CLI's own from the first commit: rewrite it freely. A **template-owned** file (`AGENTS.md`,
`docs/dev/TESTING.md`, `docs/dev/reference-clis.md`, the skills under `docs/dev/skills/`, `.github/`) holds only what
is true for every CLI made from the template. Do not rewrite one to fit this CLI: put the CLI's own facts in a seed.
A template-owned page that is wrong for this CLI is a gap in cli-template, under
[WC-DOC-3](docs.md#wc-doc-3--every-document-states-current-facts-rewrite-a-wrong-sentence-in-place) like any other
wrong sentence: fix it there, and `upgrade` brings the fix. Change it in the CLI only where the CLI must differ for
good; `upgrade` then asks before it touches the change.

## Four steps that need a person

`new` prints these at the end.

1. **Create the repository** under the owner, with a ruleset on the default branch: no deletion, no force push,
   changes only through a pull request, required status checks, and no bypass. Add the ruleset after the first
   commit is on `main`, since a pull request rule leaves an empty repository no way to get one, and the required
   check names exist only once CI has run. See [Releases](releases.md).
2. **Set npm trusted publishing** for the new package, naming `release.yml`, and add any secrets the CI needs. npm
   offers this only once the package exists, so the owner publishes the first version with `bin/release --local`
   and sets it right after. See
   [WC-REL-11](releases.md#wc-rel-11--publish-from-github-actions-with-npm-trusted-publishing).
3. **Pick a monthly cron minute** between 02:17 and 03:20 UTC that is not in the list of taken minutes under
   [WC-CI-9](ci.md#wc-ci-9--run-full-validation-and-release-security-on-the-first-day-of-each-month-without-publishing).
   The copy of `.github/workflows/monthly.yml` keeps the template's own minute, 03:02, and no check compares minutes
   across repositories, so change it by hand, and add the new minute to the list in the step 4 pull request.
4. **WireCat CLIs only: join the shared lists.** A pull request to cli-base's `PARITY_GROUPS` (at least the `all`
   group, which compares the shared root commands), a line in cli-core's `WIRECAT_TOOLS` and a line in cli-docs'
   `tools.json`. A messenger also joins cli-core's `parity.json`. A CLI outside WireCatLabs keeps its parity groups
   in its own repository and runs `cli-dev audit --groups <file>`. See [Testing](testing.md).

## Done when

All of these pass on `main`, before the first release:

- `pnpm standards:check`
- `pnpm typecheck`, `pnpm lint` and `pnpm test` with coverage
- `cli-dev lint` against the built CLI. It also makes the CLI fail once in an empty home and checks that
  `runs list` shows the failed run
- `cli-dev audit --for <cli> --lint <cli>=lint` with no new finding, run with the command trees of the CLIs in
  the same parity groups (`pnpm audit:commands`). `--lint` judges the CLI's lint rules by its own `lint/` folder.
  What it shares with the other CLIs has no baseline: `audit/baseline` does not accept a shared-contract finding
  (cli-base 0.51.0). Fix each one, or, where the CLI must differ for good, the pull request that adds it to a parity
  group declares the exact difference with its reason in that group's `differences`
- `pnpm contracts:check`
- `cli-dev test-matrix --check`
- `pnpm docs:check`, with `--pages`, and the CLI's `generate:check`
- the changelog guard on a pull request
- `pnpm release:check`

The last test is a fresh agent. Give it only this handbook's [index](README.md), the new repository and the cli-base
workflow files its own workflows pin
([WC-CI-8](ci.md#wc-ci-8--call-cli-base-node-ciyml-from-ciyml-pinned-to-a-tag-or-commit)), and ask it to audit the
CLI. Every gap it lists is either a gap in the CLI, to fix before the first release, or a hole in the
handbook, to fix here.

## The template repository itself

cli-template is a WireCat repository, and the rules for CLIs apply to it, with the few exemptions below. It holds two
programs. The skeleton CLI (`clidev`, under `src/`) is the code `new` copies, and it follows every rule for a CLI. The
copy tool (`new` and `upgrade`, under `kit/`) is the package's own `bin`; people run it by hand, once per CLI or per
upgrade, and no script or agent reads its answers.

| Rule | In cli-template | Why |
|---|---|---|
| [WC-LAY-2](layout.md) | The skeleton keeps it in `src/bin/clidev.ts`. The package's `"bin"` names the copy tool, `kit/dist/main.js`. | `new` writes the CLI's own `"bin"` entry into the copy. |
| [WC-OUT-18](output.md#wc-out-18--exit-with-cli-bases-code-for-each-kind-of-failure), [WC-OUT-19](output.md#wc-out-19--report-a-wrong-command-line-as-validation_error-exit-2) | The copy tool is exempt: it exits 1 with a plain sentence. The skeleton follows them. | People run the copy tool by hand; nothing branches on its exit code or parses its errors (owner, ASK-349). |
| [WC-TOOL-4](toolchain.md#wc-tool-4--extend-the-shared-typescript-config-and-do-not-loosen-it), [WC-TEST-11](testing.md#wc-test-11--keep-a-coverage-floor-and-raise-it-never-lower-it) | Both programs follow them: `kit/tsconfig.json` extends the shared base, and `kit/src` has its own coverage floor. | The copy tool writes into a person's new repository, so it gets the same build-time and test checks (owner, ASK-349). |
| [WC-TEST-14](testing.md#wc-test-14--check-the-upgrade-from-the-previous-published-version) | Exempt: `ci.yml` skips `contracts:upgrade`. | The skeleton has no local state of its own: its config file and run records are written by cli-core. A CLI made from the template turns the step on once it has local state and a published version to upgrade from. |
| [WC-DOC-12](docs.md#wc-doc-12--a-runnable-command-in-a-document-has-no-placeholder-in-it) | Exempt only for the placeholder names `clidev`, `clidev-cli`, `@wirecat/clidev-cli` and `WireCatLabs/clidev-cli`, and the upper-case prefix `CLIDEV_` (as in `CLIDEV_PROFILE`). | `new` replaces each of them with the CLI's own name. Any other placeholder is still a gap. |
| [WC-DOC-17](docs.md#wc-doc-17--each-entry-says-what-changed-for-the-caller-why-and-what-to-watch-for) | A changelog entry may name a file path. | The template's readers are CLI authors, who edit those files or take them with `upgrade`; for them a path is what they see. |

Every other rule that applies to all CLIs, or to the WireCat repositories, applies to cli-template as it is written,
with one limit for the copy tool. It follows the rules for code and the repository: Toolchain, Layout, Style,
Testing, Security and Documents. It has no profile, no machine mode, no MCP server, no store and no agent reading its
answers, so the rules for a CLI's commands and runtime do not reach it: Commands, Output, MCP, Accounts, Permissions,
Architecture, Lifecycle, Store, Data model and Time. Those apply to the skeleton.
