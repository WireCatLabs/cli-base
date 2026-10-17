# Toolchain

## Scope

How a repository is built and checked before review: the shared presets and `standards:check`, strict TypeScript,
the shared Biome preset and its grit plugins, the file size cap, import cycles, layer boundaries as lint, the command
lint, spelling and Markdown lint.

Rule ids on this page are `WC-TOOL-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md). What runs on which trigger is on the [CI page](ci.md).

The [community standards](https://github.com/WireCatLabs/community/blob/main/standards/README.md) repository is the
one source of the presets. Each repository holds a copy of them in `config/wirecat/`, installed by
`adopt-standards.py`. The tool reference is [cli-base `TOOLING.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/TOOLING.md).

"The ten repositories" on this page means the six CLIs (tg, max, memo, drive, zoom, wa), cli-base, cli-core,
cli-testing, cli-docs, plus community itself.

## Rules

### WC-TOOL-1 · Install the shared presets with `adopt-standards.py`, and never edit the copies

- **Why:** one reviewed set of presets keeps ten repositories alike; an edited copy drifts without anyone seeing it.
- **Enforced by:** `pnpm standards:check` · `standards.yml:standards`.
- **Example:** `python3 scripts/adopt-standards.py /path/to/project` from a community checkout, then commit
  `config/wirecat/` and the lockfile. `standards:check` compares each file in `config/wirecat/` with the hash in
  `config/wirecat/manifest.json`.
- **Exceptions:** none. A general improvement goes to community and comes back through a new adoption. A
  project-only setting goes in the root config (WC-TOOL-2).
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-2 · Make each root config extend its copy in `config/wirecat/`

- **Why:** a root config that does not extend the preset runs none of the shared rules, and nothing else would say so.
- **Enforced by:** `pnpm standards:check` · `standards.yml:standards`.
- **Example:** `biome.json` has `"extends": ["./config/wirecat/biome.base.json"]`. `cspell.json` imports
  `./config/wirecat/cspell.json`. `.markdownlint-cli2.jsonc` extends `./config/wirecat/markdownlint.json`.
  `lefthook.yml` extends `config/wirecat/lefthook.yml`.
- **Exceptions:** do not extend `@wirecat/cli-base/biome` or `@wirecat/cli-base/lefthook.yml`. No repository uses
  them, and `standards:check` accepts only the paths above.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-3 · Pin the tool versions that `toolchain.json` names

- **Why:** two Biome versions give two verdicts on the same file.
- **Enforced by:** `pnpm standards:check` · `standards.yml:standards`.
- **Example:** `package.json` has `"packageManager": "pnpm@11.20.0"` and exact `devDependencies` for
  `@biomejs/biome`, `cspell` and its three dictionaries, `lefthook` and `markdownlint-cli2`, as in the manifest.
- **Exceptions:** none.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-4 · Extend the shared TypeScript config, and do not loosen it

- **Why:** strict options catch at build time what would otherwise fail on a user's machine.
- **Enforced by:** review only.
- **Example:** `tsconfig.json` has `"extends": "@wirecat/cli-base/tsconfig.base.json"` and adds only `rootDir`,
  `outDir`, `include` and `exclude`. The base turns on `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `verbatimModuleSyntax` and `isolatedModules`.
- **Exceptions:** cli-docs is a Next.js site with its own config. cli-testing reaches the same file through
  `./node_modules/@wirecat/cli-base/config/tsconfig.base.json`. A repository may add stricter options.
- **Applies to:** the CLIs, cli-core, cli-base and cli-testing. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-5 · Typecheck every TypeScript file: source, tests and scripts

- **Why:** a folder that no `tsconfig` covers breaks without a sign, and CI stays green.
- **Enforced by:** `pnpm typecheck` · `pnpm ci:quick`.
- **Example:** `tsconfig.test.json` extends `@wirecat/cli-base/tsconfig.test.json` and covers all of `src/`, tests
  included. `tsconfig.scripts.json` extends `@wirecat/cli-base/tsconfig.scripts.json` and covers `scripts/`. The
  `typecheck` script runs all three projects.
- **Exceptions:** a new folder of TypeScript goes into one of these projects in the same pull request. memo has no
  `tsconfig.scripts.json` yet.
- **Applies to:** the CLIs, cli-core, cli-base and cli-testing. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-6 · Support Node 22 and later, and Bun

- **Why:** users install the CLIs with either runtime, so a break on one is a break for real users.
- **Enforced by:** `node-ci.yml:bun`.
- **Example:** `"engines": { "node": ">=22" }` in `package.json`. Full validation runs on Node 24, and the Bun job runs
  the built command (`pnpm build && pnpm smoke:bun`). Node 22 runs in the Windows install matrix of tg, max and wa, in
  zoom's full validation and in cli-core's old-Node job.
- **Exceptions:** cli-docs and community publish no runtime package. memo, drive and cli-base do not run Node 22 in
  any workflow yet.
- **Applies to:** the CLIs, cli-core and cli-base. **Since:** cli-base 0.41.0. **Rulings:** NEED-11.

### WC-TOOL-7 · Let Biome format the code, and do not format by hand

- **Why:** one formatter ends every argument about layout, and review reads only the change.
- **Enforced by:** `pnpm lint` · `standards.yml:standards`.
- **Example:** the shared preset sets 2 spaces, double quotes, semicolons only where needed, trailing commas, arrow
  parentheses always and 120 columns. Run `pnpm lint:fix` to apply them.
- **Exceptions:** none.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-8 · Keep the shared Biome rules at error

- **Why:** each of these rules catches a real class of bug, and a warning gets ignored.
- **Enforced by:** `pnpm lint` · `standards.yml:standards`.
- **Example:** the preset turns on Biome's recommended rules and adds, as errors: useConst, noNonNullAssertion,
  noUnusedImports, noUnusedVariables and noExplicitAny.
- **Exceptions:** a repository may add rules or raise a level. It may not turn a shared rule off (index, "Which rule
  wins").
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-9 · Write to the console only with `console.error`, except in `scripts/`

- **Why:** stdout carries data only, so a stray `console.log` breaks every caller that parses it.
- **Enforced by:** `pnpm lint` · `standards.yml:standards`.
- **Example:** the preset sets noConsole to error and allows `error`. Command output goes through the renderer and the
  streams of cli-base.
- **Exceptions:** files under `scripts/` may print, because they are development tools.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-10 · Keep the secret lint on, and suppress a finding only with its reason

- **Why:** a token caught at commit time never reaches the history; gitleaks is the second net.
- **Enforced by:** `pnpm lint` · `standards.yml:standards`.
- **Example:** noSecrets runs at error with an entropy threshold of 50. A reviewed site reads
  `// biome-ignore lint/security/noSecrets: Crockford base32 alphabet, not a key`.
- **Exceptions:** the rule is off in test files, `test/`, `tests/`, `__tests__/`, `fixtures/` and `generated/`,
  because those hold fake credentials or cannot keep a suppression comment.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-11 · Keep the three grit plugins that block unsafe calls

- **Why:** a shell or an evaluated string built from input is how a command line tool runs an attacker's code.
- **Enforced by:** `pnpm lint` · `standards.yml:standards`.
- **Example:** these plugins report at error. no-shell-true reports `shell: true` in `spawn`, `exec`, `execFile` or
  `fork` and their `Sync` forms. no-exec-interpolation reports `exec` or `execSync` with a template literal or a `+`
  concatenation. no-new-function reports `new Function(...)` and `Function(...)`.
- **Exceptions:** a reviewed site may keep a `biome-ignore` comment with the reason, for example a Windows `.cmd` shim
  with fixed arguments. The plugins read syntax, not data flow, so review and CodeQL at release cover the rest.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-12 · Do not spread a list of user data into call arguments

- **Why:** V8 throws at about 125,000 arguments, so `push(...items)` fails on a large mailbox or chat.
- **Enforced by:** `pnpm lint` · `standards.yml:standards`.
- **Example:** write `for (const item of items) out.push(item)`, not `out.push(...items)`. The no-unbounded-spread
  plugin reports `.push(...x)`, `Math.max(...x)` and `Math.min(...x)` as a warning.
- **Exceptions:** a spread over a list that is small by construction may stay. The plugin skips tests, `testing/`,
  `scripts/`, `bench/` and `performance/`.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-13 · Cap every file at 1,000 lines with Biome

- **Why:** a file past 1,000 lines always holds more than one job; the cap stops it before review has to.
- **Enforced by:** review only.
- **Example:** `biome.json` sets the style rule noExcessiveLinesPerFile to error with `"maxLines": 1000`, and turns it
  off for `**/*.test.ts`, `test/**` and `**/generated/**`. Below the cap, the review signals at 300 and 500 lines are
  in [WC-LAY-7](layout.md#wc-lay-7--treat-300-and-500-lines-as-review-signals).
- **Exceptions:** a file that is one cohesive unit may get its own override, listed by path in `biome.json` (tg
  `src/telegram/adapter.ts`; four files in cli-core). A smaller cap is allowed: zoom uses 500. cli-base, cli-testing,
  cli-docs and community have no cap yet.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-14 · Turn on the import cycle rule

- **Why:** a cycle makes load order decide which value a module sees, and the failure shows only at run time.
- **Enforced by:** review only.
- **Example:** `biome.json` sets the suspicious rule noImportCycles to error.
- **Exceptions:** cli-base, cli-testing, cli-docs and community do not have it yet.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-15 · Declare layer boundaries as restricted imports in `biome.json`

- **Why:** a boundary that only a document states is crossed in the first busy week.
- **Enforced by:** review only.
- **Example:** an override with `"includes": ["src/commands/**"]` sets the style rule noRestrictedImports with the
  folders that layer may not import, and a `message` that says why, such as "commands speak the domain model; only
  `src/client.ts` may reach the protocol". Which layers exist and which way they depend is on the
  [Architecture page](architecture.md).
- **Exceptions:** cli-base and cli-docs have no layer overrides.
- **Applies to:** the CLIs, cli-core and cli-testing. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-16 · Run the command lint on the built CLI, and let its baseline only shrink

- **Why:** the command tree is what users and agents see; the lint holds it to the shared vocabulary on every pull
  request.
- **Enforced by:** review only.
- **Example:** `"lint:commands": "cli-dev lint --cli dist/bin/max.js"`, run by `ci:quick` after the build. Known
  violations live in `lint/baseline/<rule-id>.json`; an entry with no violation left fails the run. A permanent
  exception goes in `lint/overrides.json` with `rule`, `target`, `reason`, `owner` and `review_after`. More than 10
  overrides fail the run, and so does one past its date. The rules themselves are on the
  [Commands page](commands.md).
- **Exceptions:** zoom runs `lint:commands` in full validation only. cli-core runs its own command lint test in
  `ci:quick`. cli-base, cli-testing, cli-docs and community have no command tree.
- **Applies to:** the CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-17 · Spell-check prose with the shared `cspell` config

- **Why:** a typo in a page or a help text is the first thing a reader sees.
- **Enforced by:** `pnpm docs:spell`.
- **Example:** `cspell.json` imports `./config/wirecat/cspell.json` (English, British English, Russian, Spanish and the
  WireCat word list) and adds only the project's own words. Code blocks and inline code are not checked.
- **Exceptions:** a general word goes into the community word list, not into each project. In tg, max, wa, zoom and
  cli-testing, `cspell` also runs inside `docs:check` in full validation.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-18 · Lint Markdown with `markdownlint-cli2` and the shared preset

- **Why:** a code block with no language or an empty link breaks the docs site and agent readers alike.
- **Enforced by:** `pnpm docs:lint` · `standards.yml:standards`.
- **Example:** the preset turns on only: no tabs (MD010), at most two blank lines in a row (MD012), a language on
  every fenced code block (MD040) and no empty links (MD042). `.markdownlint-cli2.jsonc` lists the files to check.
- **Exceptions:** a repository may turn on more rules in its root config.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-19 · Check user pages with `rumdl` and the shared `rumdl.toml`

- **Why:** user pages feed the docs site, so their Markdown form is checked more closely than developer notes.
- **Enforced by:** review only.
- **Example:** `rumdl check --config config/wirecat/rumdl.toml README.md docs/*.md`, inside `docs:check`. The preset
  turns off line length (MD013), first-line heading (MD041) and relative links (MD057), because other checks cover
  them.
- **Exceptions:** memo, drive, cli-base and cli-core do not run `rumdl` yet.
- **Applies to:** the CLIs and cli-testing. **Since:** cli-base 0.41.0. **Rulings:** none.
