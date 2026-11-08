# Shared tooling

The configuration, development scripts and CI that every CLI on cli-base used to copy. A repository
takes each piece on its own.

**TypeScript.** Compiler options only; paths and file lists stay in the repository, because `tsc`
resolves them against the file that declares them.

```jsonc
// tsconfig.json
{
  "extends": "@wirecat/cli-base/tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
// tsconfig.test.json — checks every file under src/, tests included, without emitting
{ "extends": ["./tsconfig.json", "@wirecat/cli-base/tsconfig.test.json"] }
// tsconfig.scripts.json — checks scripts/
{ "extends": ["./tsconfig.json", "@wirecat/cli-base/tsconfig.scripts.json"] }
```

**Biome.** Formatter, linter and the rule that lets `scripts/` print. Your `files.includes` and
your own `overrides` (import boundaries) stay in your file; Biome adds them to the shared ones.
Write the specifier without `.json`: Biome reads anything ending in `.json` as a relative path.

```json
{ "extends": ["@wirecat/cli-base/biome"], "files": { "includes": ["**", "!**/dist", "!**/node_modules", "!pnpm-lock.yaml"] } }
```

**Biome plugin for a CLI on cli-core.** `config/lint/no-own-settings.grit` refuses a call to `resolveSettings` outside
`baseContext(…)`: a context built that way skips the run, `--timeout` and the profile's permissions
([WC-LIFE-17](standards/lifecycle.md#wc-life-17--send-every-request-to-the-provider-inside-cli-cores-command-run-with-the-runs-events)).
Add it to your own `plugins`, for `src/` without its tests; a read that has no command yet, such as the update check,
takes `// biome-ignore lint/plugin/no-own-settings: <why>`.

```json
{ "plugins": [{ "path": "./node_modules/@wirecat/cli-base/config/lint/no-own-settings.grit", "includes": ["src/**", "!**/*.test.ts"] }] }
```

**lefthook.** Biome and gitleaks on staged files before a commit, `pnpm typecheck` before a push.
An extended file **overrides** your `lefthook.yml`; to change a shared hook, use `lefthook-local.yml`.

```yaml
extends:
  - node_modules/@wirecat/cli-base/config/lefthook.yml
```

**`cli-dev`.** Installed with the package; `pnpm exec cli-dev help` lists the commands.

| Instead of | Run |
|---|---|
| `scripts/slow-tests.ts` | `cli-dev slow-tests [report] [count]` |
| `scripts/next-version.mjs` | `cli-dev next-version <wanted> <latest> <versions-json>` |
| `scripts/version.ts` | `cli-dev version [--sync] [--file src/version.ts]` |
| `scripts/docs-check.ts` | `cli-dev docs-check --rules scripts/release/checks.ts`, or `--ids CLI,MAX` with the English defaults |
| `scripts/test-matrix.ts` | `cli-dev test-matrix --program dist/program.js --untested scripts/test-matrix-untested.ts --name max [--check]` |

| — | `cli-dev lint --cli dist/bin.js` (or `--commands <file>`): the command tree against the standard |
| — | `cli-dev audit --cli <bin> --cli <bin> …`: several CLIs against the standard and against each other |
| — | `cli-dev release-pr --base <commit> --body <file>`: a pull request that changes the version needs a `## Conformance` section ([WC-REL-17](standards/releases.md#wc-rel-17--a-release-pull-request-says-what-was-checked-and-the-release-needs-a-recorded-live-check)) |
| — | `cli-dev live record --script <path>` after a live check passed; `cli-dev live check` in `bin/release` ([WC-REL-17](standards/releases.md#wc-rel-17--a-release-pull-request-says-what-was-checked-and-the-release-needs-a-recorded-live-check)) |
| — | `cli-dev repo-check --cli <name>`: main's ruleset and its required checks, the `npm` environment, the monthly cron minute and a parity group ([New CLI](standards/new-cli.md#four-steps-that-need-a-person)) |
| `scripts/bundle.ts` (tg) | `cli-dev bundle --bin dist/bin/<cli>.js [--external <package>]…`: the published bin as an esbuild bundle and its loader ([WC-LAY-10](standards/layout.md#wc-lay-10--ship-the-bin-as-a-bundle-that-cli-dev-bundle-builds)) |

`cli-dev lint` reads `<cli> commands --json`, refuses a document not in `commandsDocument`'s shape, and
judges it by `LINT_RULES` and `VOCABULARY` from `/standards/tables`. Known violations live in
`lint/baseline/<rule-id>.json`, one file per rule, and may only shrink: an entry with no violation left
fails the run, or only warns with `--allow-stale`, which a shared package's CI passes when it lints the CLIs built
against it: a word it added makes their entries stale, and that cleanup is theirs. `--write-baseline` rewrites those
files to today's violations. Permanent exceptions go in
`lint/overrides.json` — `[{ "rule", "target", "reason", "owner", "review_after" }]`, `owner` a GitHub handle
(`@octocat`), `review_after` a date — and more than `--budget` (10) of them fails, as does one past its
`review_after`. An entry that does not fit that shape fails the run by its number and is ignored; the others still
apply. The `wcat-bin-name` and `wcat-describe` warnings are overridden the same way. `cli-dev audit` names a rule overridden more than three times across the CLIs it reads, for review.
`flag-synonym` reports another name for a vocabulary flag (`--take` for `--limit`, from the flag's `replaces`), and
`identifier-name` an identifier key the glossary (`IDENTIFIERS`) names another way (`execution_id` for `run_id`).
Every option needs a role from the vocabulary (`paging`, `output`, `sort`, `mode`, `action`, `budget`, `scope`,
`target`, `value`, `query`) — there is no filter role. `filter-flag` reports an option of a read-only command
named after a field of its entity (`--kind`, `--since-time`, `--before-id`), except a `scope` flag such as
`--account`; `list-without-query` a `list` with an `output` entity and no query; `query-example` a field example
or default term that does not run. `missing-command-effects` reports a command that runs — a leaf, or a group with
an action of its own (`runnable` in the document) — and declares no `effects`. `--schemas <file>` names a JSON object of the CLI's own JSON Schemas by name; `key-casing` checks their
keys, cli-base's envelope, error, log record and commands document schemas, and the document as printed. Its entry
`log_attributes` (`logAttributesJsonSchema(allow)`) is the CLI's log allow-list instead: `log-attribute-key` fails a
key that names message text, a token or a phone number. `missing-run-log` reports a tree with no `runs list`,
`runs show`, global `--record` or `--no-record`. With `--cli` and a `runs list`, it also runs the CLI once with an
unknown flag, with a new empty home and only `PATH` from the environment, and reports it when `runs list --json` then
shows no failed run.

`raw-network` and `undeclared-host` read the CLI's own source under `src` (tests, fixtures, the fakes in `src/testing`,
`dist` and `node_modules` left out), not the commands document. `raw-network` reports an import of `node:http`, `https`, `http2`, `net`, `tls`
or `dgram` (with or without `node:`), `undici`, `axios`, `got`, `node-fetch` or `ws` (static, dynamic or `require`;
type-only imports pass), and a call of the global `fetch` or any `globalThis.fetch`, with the target
`<file> <module>` or `<file> fetch`. A file that binds its own `fetch` (`const fetch = hostFetch(…)`, an injected one)
calls that one. `undeclared-host` reports each `http(s)://` host outside a comment line that `network.hosts` of the
shipped `contracts/wirecat.json` does not cover, the target the host alone and the files in the message; the `docs_url` host, `example`, `test` and
`invalid` names, `json-schema.org` and `www.w3.org` are skipped. Without `network.hosts` it is skipped, and the run
says so. Both are lints, not a sandbox: a dependency or a computed URL passes them.

`cli-dev audit` reads two or more commands documents (`--cli <bin>` or `--commands <file>`, repeated) and prints a
scorecard: per CLI and rule, what it found, what the baseline holds, what is overridden, what is new and what was
fixed; `--json` prints it as the list envelope. Every lint rule judges each CLI alone; `AUDIT_RULES` in `/standards/tables`
compare them: `required-root` (`REQUIRED_ROOTS`: `commands`, `doctor`, `skill show|install`, `mcp`, `upgrade`),
`same-path-contract` (a path two CLIs of a parity group share has the same options, value names, output and summary;
a group covering the whole tree has the same paths), `same-flag-meaning`, `same-entity-schema` (from `--schemas
<cli>=<file>`) and `same-error-reason` (from `--reasons <cli>=<file>`, a JSON list of `defineReasons` entries). The two
last rules print `n/a` for a CLI that gave no such file. `PARITY_GROUPS` names who is compared where — `messengers`
(tg, max) over the whole tree, `all` over the shared roots, `mail-shared` and `gcal-shared` over the roots mail and
gcal already share, `shared-roots` over `commands`, `doctor`, `skill`, `mcp` and `upgrade` for b24 and beeline — and each group's declared `differences`, each with a reason, at most 10. `--groups <file>`
replaces `PARITY_GROUPS` with the JSON list of groups in that file, in the same shape and
checked the same way, so a CLI outside WireCatLabs keeps its own groups in its repository and lists itself next to
ours; `--differences <file>` (entries of `group`, `rule`, `target`, `expected`, `reason`) then adds to whichever groups
are in use. Known findings live in `audit/baseline/<rule>.json` (`--baseline`), targets naming the CLIs
(`max+tg chats list --limit`, `tg: chats grab` for a lint violation); `--write-baseline` rewrites them. `--lint
<cli>=<dir>` judges that CLI's lint rules by its own `lint/` folder instead. A new finding fails the run — only one
naming `--for <cli>` when given — and a fixed one is reported, not failed. `AUDIT_BLOCKS` decides whether a new
cross-CLI divergence fails the run (`"new"`) or only shows (`"never"`); a new lint violation always fails. A document
from a cli-base before 0.26, with camelCase keys, is read too, and `key-casing` reports it. The weekly `Weekly CLI
audit` workflow runs it over the five latest published CLIs and rewrites the pinned issue labelled `cli-audit`.

`--rules` names a module exporting `CHANGELOG` and `docsRules(root)`; `--program` one exporting
`createProgram`; `--untested` one exporting `UNTESTED`. A TypeScript module loads on Node 24 as it is.

**Docs.** Spelling, Markdown form and prose rules for the pages a user reads. The tools are your
own dev dependencies (`cspell`, `@cspell/dict-ru_ru`, `@cspell/dict-en-gb`, `rumdl`); the settings
and the shared word list are here. Code blocks and inline code are not spell-checked: commands and
options are checked against the program by the parity check.

```jsonc
// cspell.json — the dictionaries resolve from your node_modules, so you import them yourself
{
  "version": "0.2",
  "import": ["@wirecat/cli-base/cspell", "@cspell/dict-en-gb/cspell-ext.json", "@cspell/dict-ru_ru/cspell-ext.json"],
  "ignorePaths": ["docs/commands.md", "docs/dev/**", "CHANGELOG.md"],
  "words": []
}
```

```sh
cspell --no-progress README.md "docs/*.md"
rumdl check --config node_modules/@wirecat/cli-base/config/rumdl.toml README.md docs/*.md
vale README.md docs/*.md   # .vale.ini: StylesPath = node_modules/@wirecat/cli-base/config/vale
```

`cli-dev docs-check --pages` adds the structure check: `docs/` against `docs/meta.json`, the
sidebar of [the docs portal](https://github.com/WireCatLabs/cli-docs/blob/main/docs/STRUCTURE.md).
Vale's styles are `CliDocs` (filler words, long sentences) and `Tg` (tg's tone: a Telegram client,
never "unofficial"); its rules warn rather than fail until they are tuned.

**CI.** Install, lint, typecheck, test with coverage, build, your extra checks, Bun, and a gitleaks
scan of the whole history. Jobs only your repository needs stay beside it in your `ci.yml`.

```yaml
jobs:
  ci:
    uses: WireCatLabs/cli-base/.github/workflows/node-ci.yml@v<version>
    with:
      checks: |
        pnpm docs:check
      bun-run: pnpm build && pnpm smoke:bun   # the default is pnpm smoke:bun
```

Inputs: `node-version` (`"24"`), `checks` (shell lines run after the build), `bun` (`true`),
`bun-run`. The workflow is in the repository, not the package: pin a tag or a commit, not `main`.

A CLI sets `cli: true`. After the build the job then runs one named step per script, in this order:
`contracts:check`, `contracts:upgrade`, `security:no-leak`, `version:check`, `generate:check`,
`test:matrix:check`, `docs:check`, `package:check`, `lint:commands`, and `parity:check` when `parity: true`.
A missing script fails its step, so a check nobody wired up shows as red, not as a line nobody wrote.
`skip` lists the steps a CLI cannot have yet, one per line; say why beside it in your `ci.yml`.
`checks` still runs after them, for what is yours alone.

`platforms: true` adds a job on Windows and macOS: install, `pnpm test` (one worker on Windows), build,
`node dist/bin/<bin>.js --version`, then the lines in `platform-run` (commands that need no login).

`test-shards: 4` (2 to 8) takes `test:coverage` out of `check`: four `test (i/4)` jobs each
run one Vitest shard, and `coverage` merges them and enforces the floor. With `cli: true`, `coverage` also runs
`test:matrix:check` on the shards' argv logs joined. Require `<job> / ci / coverage` beside
`<job> / ci / check`.

```yaml
    with:
      cli: true
      parity: true
      bin: max
      platforms: ${{ !inputs.skip-platforms }}
      platform-run: |
        node dist/bin/max.js default doctor --json
      skip: |
        contracts:upgrade
```
