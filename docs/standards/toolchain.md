# Toolchain

<!-- cspell:ignore gofmt -->

## Scope

How a repository is built and checked before review: the shared presets and `standards:check`, strict TypeScript,
the shared Biome preset and its grit plugins, the file size cap, import cycles, layer boundaries as lint, the command
lint, spelling, Markdown lint, and the checks for a Go part.

Rule ids on this page are `WC-TOOL-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md). What runs on which trigger is on the [CI page](ci.md).

The [community standards](https://github.com/WireCatLabs/community/blob/main/standards/README.md) repository is the
one source of the presets. Each repository holds a copy of them in `config/wirecat/`, installed by
`adopt-standards.py`.

"The WireCat repositories" on this page means every WireCat CLI (today tg, max, memo, drive, zoom, wa and gcal; a
CLI made with `npx @wirecat/cli-template new` counts from its first commit), cli-base, cli-core, cli-testing, cli-docs,
plus community itself. cli-template follows every rule here as a CLI does
([New CLI](new-cli.md#the-template-repository-itself)).

## Rules

### WC-TOOL-1 · Install the shared presets with `adopt-standards.py`, and never edit the copies

- **Why:** one reviewed set of presets keeps the repositories alike; an edited copy drifts without anyone seeing it.
- **Enforced by:** `pnpm standards:check` · `standards.yml:standards`.
- **Example:** `python3 scripts/adopt-standards.py /path/to/project` from a community checkout, then commit
  `config/wirecat/` and the lockfile. `standards:check` compares each file in `config/wirecat/` with the hash in
  `config/wirecat/manifest.json`.
- **Exceptions:** none. A general improvement goes to community and comes back through a new adoption. A
  project-only setting goes in the root config (WC-TOOL-2).
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-2 · Make each root config extend its copy in `config/wirecat/`

- **Why:** a root config that does not extend the preset runs none of the shared rules, and nothing else would say so.
- **Enforced by:** `pnpm standards:check` · `standards.yml:standards`.
- **Example:** `biome.json` has `"extends": ["./config/wirecat/biome.base.json"]`. `cspell.json` imports
  `./config/wirecat/cspell.json`. `.markdownlint-cli2.jsonc` extends `./config/wirecat/markdownlint.json`.
  `lefthook.yml` extends `config/wirecat/lefthook.yml`.
- **Exceptions:** do not extend `@wirecat/cli-base/biome` or `@wirecat/cli-base/lefthook.yml`. No repository uses
  them, and `standards:check` accepts only the paths above.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-3 · Pin the tool versions that `toolchain.json` names

- **Why:** two Biome versions give two verdicts on the same file.
- **Enforced by:** `pnpm standards:check` · `standards.yml:standards`.
- **Example:** `package.json` has `"packageManager": "pnpm@11.20.0"` and exact `devDependencies` for
  `@biomejs/biome`, `cspell` and its three dictionaries, `lefthook` and `markdownlint-cli2`, as in the manifest.
- **Exceptions:** none.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

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

- **Why:** a folder that no `tsconfig` covers breaks without a sign, and a test that compares against a constant that
  does not exist passes for any input while CI stays green.
- **Enforced by:** `pnpm typecheck` · `pnpm ci:quick` · `node-ci.yml:check`.
- **Example:** `tsconfig.test.json` has `"extends": ["./tsconfig.json", "@wirecat/cli-base/tsconfig.test.json"]`, in
  that order, and adds at most `rootDir` and an `include` for more folders. The shared file covers all of `src/`,
  tests included, checks it with `noEmit` and sets `"exclude": []`, so it must come last and the repository's file sets
  no `exclude` of its own. A file that sets the build's `exclude` again checks no test file and still passes.
  `tsconfig.scripts.json` extends `@wirecat/cli-base/tsconfig.scripts.json` and covers `scripts/`. The `typecheck`
  script runs all three projects.
- **Exceptions:** a new folder of TypeScript goes into one of these projects in the same pull request. memo has no
  `tsconfig.scripts.json` yet.
- **Applies to:** the CLIs, cli-core, cli-base and cli-testing. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-6 · Support Node 22 and later, and Bun, and run the built exports under Bun

- **Why:** users install the CLIs with either runtime, and a static import of one runtime's module fails to load on
  the other.
- **Enforced by:** `pnpm smoke:bun` · `node-ci.yml:bun` · `node-ci.yml:platforms` (the unit suite on Windows and
  macOS).
- **Example:** `"engines": { "node": "^22.16.0 || >=24" }` in `package.json`, as cli-core and cli-template have it:
  Node 22 from 22.16.0, then 24 and later. Full validation runs on Node 24. `bun test` cannot run the vitest suite, so
  `scripts/smoke.ts` runs the built exports with plain assertions, and the Bun job runs it
  (`pnpm build && pnpm smoke:bun`). A new entry point gets a line there. Node 22 runs in the Windows install matrix of
  tg, max and wa, in zoom's full validation and in cli-core's old-Node job.
- **Exceptions:** cli-docs and community publish no runtime package. tg needs `^22.19.0`. memo, drive and cli-base
  do not run Node 22 in any workflow yet, and cli-base's own `engines` is still `>=22`. The unit suite runs on Windows
  and macOS for tg, max and drive (`platforms: true`); zoom and memo still fail tests there, so theirs is off.
- **Applies to:** the CLIs, cli-core and cli-base. **Since:** cli-base 0.41.0. **Rulings:** NEED-11.

### WC-TOOL-7 · Let Biome format the code, and do not format by hand

- **Why:** one formatter ends every argument about layout, and review reads only the change.
- **Enforced by:** `pnpm lint` · `standards.yml:standards`.
- **Example:** the shared preset sets 2 spaces, double quotes, semicolons only where needed, trailing commas, arrow
  parentheses always and 120 columns. Run `pnpm lint:fix` to apply them.
- **Exceptions:** none.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-8 · Keep the shared Biome rules at error

- **Why:** each of these rules catches a real class of bug, and a warning gets ignored.
- **Enforced by:** `pnpm lint` · `standards.yml:standards`.
- **Example:** the preset turns on Biome's recommended rules and adds, as errors: useConst, noNonNullAssertion,
  noUnusedImports, noUnusedVariables and noExplicitAny.
- **Exceptions:** a repository may add rules or raise a level. It may not turn a shared rule off (index, "Which rule
  wins").
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-9 · Write to the console only with `console.error`, except in `scripts/`

- **Why:** stdout carries data only, so a stray `console.log` breaks every caller that parses it.
- **Enforced by:** `pnpm lint` · `standards.yml:standards`.
- **Example:** the preset sets noConsole to error and allows `error`. Command output goes through the renderer and the
  streams of cli-base.
- **Exceptions:** files under `scripts/` may print, because they are development tools. A shared package prints
  nothing at all, not even with `console.error`
  ([WC-ARCH-19](architecture.md#wc-arch-19--shared-packages-print-nothing-and-log-nothing-on-their-own)).
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-10 · Keep the secret lint on, and suppress a finding only with its reason

- **Why:** a token caught at commit time never reaches the history; gitleaks is the second net.
- **Enforced by:** `pnpm lint` · `standards.yml:standards`.
- **Example:** noSecrets runs at error with an entropy threshold of 50. A reviewed site reads
  `// biome-ignore lint/security/noSecrets: Crockford base32 alphabet, not a key`.
- **Exceptions:** the rule is off in test files, `test/`, `tests/`, `__tests__/`, `fixtures/` and `generated/`,
  because those hold fake credentials or cannot keep a suppression comment.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-11 · Keep the three grit plugins that block unsafe calls

The shared Biome preset loads six grit plugins. This rule covers the three that block unsafe calls. The other
three have their own rules: no-deep-wirecat-import
([WC-ARCH-8](architecture.md#wc-arch-8--cross-a-module-boundary-only-through-the-modules-entry-point)),
no-sqlite-driver ([WC-STORE-5](store.md#wc-store-5--a-cli-writes-no-sql-against-the-shared-store)) and
no-unbounded-spread ([WC-TOOL-12](#wc-tool-12--do-not-spread-a-list-of-user-data-into-call-arguments)).

- **Why:** a shell or an evaluated string built from input is how a command line tool runs an attacker's code.
- **Enforced by:** `pnpm lint` · `standards.yml:standards`.
- **Example:** these plugins report at error. no-shell-true reports `shell: true` in `spawn`, `exec`, `execFile` or
  `fork` and their `Sync` forms. no-exec-interpolation reports `exec` or `execSync` with a template literal or a `+`
  concatenation. no-new-function reports `new Function(...)` and `Function(...)`.
- **Exceptions:** a reviewed site may keep a `biome-ignore` comment with the reason, for example a Windows `.cmd` shim
  with fixed arguments. The plugins read syntax, not data flow, so review and CodeQL at release cover the rest.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-12 · Do not spread a list of user data into call arguments

- **Why:** V8 throws at about 125,000 arguments, so `push(...items)` fails on a large mailbox or chat.
- **Enforced by:** `pnpm lint` · `standards.yml:standards`.
- **Example:** write `for (const item of items) out.push(item)`, not `out.push(...items)`. The no-unbounded-spread
  plugin reports `.push(...x)`, `Math.max(...x)` and `Math.min(...x)` as a warning.
- **Exceptions:** a spread over a list that is small by construction may stay. The plugin skips tests, `testing/`,
  `scripts/`, `bench/` and `performance/`.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-13 · Cap every file at 1,000 lines with Biome

- **Why:** a file past 1,000 lines always holds more than one job; the cap stops it before review has to.
- **Enforced by:** `pnpm lint` · `standards.yml:standards` (the shared Biome base, like WC-TOOL-8).
- **Example:** the shared Biome base (community `standards/configs/biome.base.json`) sets the style rule
  noExcessiveLinesPerFile to error with `"maxLines": 1000`, and turns it off for tests, `fixtures/` and `generated/`. Below the cap, the review signals at 300 and 500 lines are
  in [WC-LAY-7](layout.md#wc-lay-7--treat-300-and-500-lines-as-review-signals).
- **Exceptions:** a file that is one cohesive unit may get its own override, listed by path in `biome.json` (tg
  `src/telegram/adapter.ts`; four files in cli-core). A smaller cap is allowed: zoom uses 500. cli-docs turns it off for
  stylesheets. Biome reads only JavaScript and TypeScript, so the cap does not cover
  code in another language, such as wa's Go engine; the review signals of WC-LAY-7 still apply to it.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-14 · Turn on the import cycle rule

- **Why:** a cycle makes load order decide which value a module sees, and the failure shows only at run time.
- **Enforced by:** `pnpm lint` · `standards.yml:standards` (the shared Biome base, like WC-TOOL-8).
- **Example:** the shared Biome base sets the suspicious rule noImportCycles to error.
- **Exceptions:** none.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-15 · Declare layer boundaries as restricted imports in `biome.json`

- **Why:** a boundary that only a document states is crossed in the first busy week.
- **Enforced by:** `<app>: biome noRestrictedImports` · `cli-testing: biome noRestrictedImports`.
- **Example:** an override with `"includes": ["src/commands/**"]` sets the style rule noRestrictedImports with the
  folders that layer may not import, and a `message` that says why, such as "commands speak the domain model; only
  `src/client.ts` may reach the protocol". Which layers exist and which way they depend is on the
  [Architecture page](architecture.md).
- **Exceptions:** cli-base and cli-docs have no layer overrides.
- **Applies to:** the CLIs, cli-core and cli-testing. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-16 · Run the command lint on the built CLI, and let its baseline only shrink

- **Why:** the command tree is what users and agents see; the lint holds it to the shared vocabulary on every pull
  request.
- **Enforced by:** `<app>: pnpm lint:commands`.
- **Example:** `"lint:commands": "cli-dev lint --cli dist/bin/max.js"`, run by `ci:quick` after the build. Known
  violations live in `lint/baseline/<rule-id>.json`; an entry with no violation left fails the run. A violation that a
  shared package forces, such as a verb cli-core names before the vocabulary has it, goes in the baseline too and
  comes out when the shared package catches up. A word the CLI needs that the vocabulary does not have yet goes in
  `lint/overrides.json`, never in the baseline: its `reason` links the cli-base pull request or issue that adds the
  word, its `review_after` is at most 30 days away, and it comes out in the change that takes the cli-base release
  with the word. A permanent exception also goes in `lint/overrides.json`, with `rule`, `target`, `reason`, `owner`
  and `review_after`. More than 10
  overrides fail the run, and so does one past its date. The rules themselves are on the
  [Commands page](commands.md).
- **Exceptions:** zoom runs `lint:commands` in full validation only. cli-core runs its own command lint test in
  `ci:quick`. cli-base, cli-testing, cli-docs and community have no command tree.
- **Applies to:** the CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-17 · Spell-check prose with the shared `cspell` config

- **Why:** a typo in a page or a help text is the first thing a reader sees.
- **Enforced by:** `pnpm docs:spell` · `pnpm docs:check`.
- **Example:** `cspell.json` imports `./config/wirecat/cspell.json` (English, British English, Russian, Spanish and the
  WireCat word list) and adds only the project's own words. A repository checks `README.md` and every user page,
  `docs/*.md`, in `docs:spell` or in `docs:check`. Generated pages (`docs/commands.md`), `docs/dev/` and
  `CHANGELOG.md` may be left out. Code blocks and inline code are not checked.
- **Exceptions:** a general word goes into the community word list, not into each project. cli-base checks
  `README.md` and `docs/standards/`; cli-docs its site pages in `content/docs/`; community every Markdown file it
  publishes. cli-core, zoom and cli-testing check only `README.md` yet.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-18 · Lint Markdown with `markdownlint-cli2` and the shared preset

- **Why:** a code block with no language or an empty link breaks the docs site and agent readers alike.
- **Enforced by:** `pnpm docs:lint` · `standards.yml:standards`.
- **Example:** the preset turns on only: no tabs (MD010), at most two blank lines in a row (MD012), a language on
  every fenced code block (MD040) and no empty links (MD042). `.markdownlint-cli2.jsonc` lists the files to check.
- **Exceptions:** a repository may turn on more rules in its root config.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-19 · Check user pages with `rumdl` and the shared `rumdl.toml`

- **Why:** user pages feed the docs site, so their Markdown form is checked more closely than developer notes.
- **Enforced by:** `tg-cli: pnpm docs:check` · `max-cli: pnpm docs:check` · `whatsapp-cli: pnpm docs:check` ·
  `zoom-cli: pnpm docs:check` · `cli-testing: pnpm docs:check`.
- **Example:** `rumdl check --config config/wirecat/rumdl.toml README.md docs/*.md`, inside `docs:check`. The preset
  turns off line length (MD013), first-line heading (MD041) and relative links (MD057), because other checks cover
  them.
- **Exceptions:** memo, drive, cli-base and cli-core do not run `rumdl` yet.
- **Applies to:** the CLIs and cli-testing. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TOOL-20 · Build a Go part with the version in `go.mod`, and check it with gofmt, vet and its tests

- **Why:** the TypeScript checks do not read Go, so a Go part with no checks of its own drifts without anyone seeing
  it.
- **Enforced by:** `whatsapp-cli: engine-pr.yml:engine` · `whatsapp-cli: ci.yml:engine`.
- **Example:** every workflow that builds the Go part uses `actions/setup-go` with `go-version-file` pointing at its
  `go.mod`, never a version written in the workflow. A path-scoped pull request job and full validation both run
  `gofmt -l .` (any file listed fails), `go vet ./...` and `go test ./...` in the Go folder. wa's engine is the
  example.
- **Exceptions:** none.
- **Applies to:** CLIs with a Go part (wa). **Since:** cli-base 0.44.0. **Rulings:** none.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [community standards](https://github.com/WireCatLabs/community/blob/main/standards/README.md)
- [cli-base `TOOLING.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/TOOLING.md)
