# CI

## Scope

What runs where: the local hooks, the fast checks and the Linux validation on every pull request, full validation
on each merge to `main`, and the monthly runs.

Rule ids on this page are `WC-CI-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md). What each tool checks is on the [Toolchain page](toolchain.md); the release workflow is on the
[Releases page](releases.md); which scanners must exist and how workflows are hardened is on the
[Security page](security.md).

"The WireCat repositories" on this page means every WireCat CLI (today tg, max, memo, drive, zoom, wa and gcal; a
CLI made with `npx @wirecat/cli-template new` counts from its first commit), cli-base, cli-core, cli-testing, cli-docs,
plus community itself. cli-template follows every rule here as a CLI does
([New CLI](new-cli.md#the-template-repository-itself)).

## Rules

### WC-CI-1 · Run only staged lint and a staged secret scan before a commit

- **Why:** a hook that takes more than a second makes people skip it, which is worse than a small hook.
- **Enforced by:** `pnpm standards:check` · `standards.yml:standards`.
- **Example:** the shared `lefthook` config runs, in parallel, Biome on the staged files and
  `gitleaks git --staged --redact`. A clone without gitleaks gets a warning and can still commit; CI scans anyway.
  The `prepare` script installs the hooks; `LEFTHOOK=0 git commit` skips them for one commit.
- **Exceptions:** none.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-2 · Add no push hook, and no hook that installs, builds, checks types, generates or tests

- **Why:** every check in a hook runs again in CI, so a slow hook only costs time and teaches people to bypass hooks.
- **Enforced by:** review only.
- **Example:** a repository's `lefthook.yml` holds only the `extends` line for `config/wirecat/lefthook.yml`. An agent
  does not run `standards:check`, the full lint, spelling, a build or the test suite on each commit or push; it runs a
  targeted check when it needs one.
- **Exceptions:** none. cli-base `config/lefthook.yml` still has a pre-push typecheck, but no repository extends it.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-3 · Run the fast standards job on every pull request and every push to `main`

- **Why:** it catches broken presets, lint, Markdown, types and new secrets in well under a minute, before review.
- **Enforced by:** `standards.yml:standards`.
- **Example:** the job does one cached install with lifecycle scripts off, then runs `pnpm standards:check`,
  `pnpm lint`, `pnpm docs:lint`, `pnpm run --if-present ci:quick` and a gitleaks scan of the new commits only. A new
  commit cancels the run it replaces. The job times out after five minutes, a ceiling for a stalled setup, not an
  expected time.
- **Exceptions:** none. Runner queues and cold downloads are outside the budget.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-4 · Keep `ci:quick` to early bug checks that finish within two minutes

- **Why:** it is the first build-level answer on a pull request, so it must stay fast enough that nobody wants it gone.
- **Enforced by:** `standards.yml:standards` · `pnpm ci:quick`.
- **Example:** what each repository runs today:
  - tg, max, memo, wa and cli-template: `pnpm typecheck && pnpm build && pnpm lint:commands`;
  - drive: `pnpm typecheck && pnpm lint:commands`, which builds first;
  - zoom, cli-base and cli-testing: `pnpm typecheck`;
  - cli-core: `pnpm typecheck` and its command lint test;
  - cli-docs: its unit tests, without the one that needs generated pages;
  - community: its script tests.
- **Exceptions:** never put live-account suites, agent suites or platform jobs here. Full tests and coverage run in
  the pull request validation job ([WC-CI-5](#wc-ci-5--run-the-full-linux-validation-on-every-pull-request-and-keep-platform-suites-out)),
  not in `ci:quick`.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-5 · Run the full Linux validation on every pull request, and keep platform suites out

- **Why:** a pull request that lowers coverage or breaks a contract must fail before it merges; once on `main` it
  blocks every other branch and the next release. It costs 2–3 minutes per pull request in the CLIs (measured: wa
  2.9, tg 2.2, max 3.0) and about 5 in cli-core, where `test:coverage` alone takes about 4; `node-ci.yml`'s
  `test-shards` input splits it across runners.
- **Enforced by:** `pr.yml:validation`.
- **Example:** `pr.yml` runs on `pull_request` and calls the repository's own `ci.yml`, the same full validation as
  `main` (WC-CI-7): lint, typecheck, `test:coverage` with the coverage floor, build, the contracts, the test matrix,
  `docs:check` and parity, the Bun job and the secret scan. It passes `skip-platforms: true` where `ci.yml` has that
  input, and a new commit cancels the run it replaces:

  ```yaml
  on:
    pull_request:
  concurrency:
    group: pr-validation-${{ github.event.pull_request.number }}
    cancel-in-progress: true
  permissions:
    contents: read
  jobs:
    validation:
      uses: ./.github/workflows/ci.yml
      with:
        skip-platforms: true
  ```

  It runs beside the standards job (WC-CI-3), which stays the fast first answer.
- **Exceptions:** Windows, macOS and install checks stay out of pull requests and run in full validation at release,
  monthly or on request. A path-scoped job that tests one platform-specific file may run on pull requests, such as
  cli-base `macos.yml` for the path code. cli-docs and community run `security-pr.yml`, a new-commit secret scan;
  cli-docs validates its site before each deployment instead, and community has no build. Third-party security apps
  may post their own checks.
- **Applies to:** the CLIs, cli-base, cli-core and cli-testing. cli-base, whatsapp-cli, tg-cli, max-cli, cli-core,
  cli-memo, zoom-cli, drive-cli and cli-template have `pr.yml`; cli-testing does not have it yet. **Since:**
  cli-base 0.41.0 (pull request validation since cli-base 0.45.0). **Rulings:** none.

### WC-CI-6 · Run the changelog guard on every pull request

- **Why:** the guard is the only check that reads the changelog on a pull request.
- **Enforced by:** `changelog-guard.yml:guard`.
- **Example:** each repository's `changelog-guard.yml` calls
  `WireCatLabs/cli-base/.github/workflows/changelog-guard.yml` at a pinned commit, on `opened`, `edited`,
  `synchronize` and `reopened`. The changelog rules it applies are on the [Documents page](docs.md).
- **Exceptions:** cli-testing, cli-docs and community have no changelog guard yet.
- **Applies to:** the CLIs, cli-base and cli-core. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-7 · Run full validation once on each merge to `main`, on Linux, without publishing

- **Why:** two pull requests that each pass on their own can still break each other once both are merged; `main`
  catches that merge skew the same hour, not at the next release.
- **Enforced by:** `main.yml:validation` · `node-ci.yml:check` · `node-ci.yml:bun` · `node-ci.yml:secrets`.
- **Example:** `main.yml` calls the repository's own `ci.yml`, which calls cli-base `node-ci.yml`. That runs
  `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` and `pnpm build`. With `cli: true` it then runs one named step
  per CLI script: `contracts:check`, `contracts:upgrade`, `security:no-leak`, `version:check`, `generate:check`,
  `test:matrix:check`, `docs:check`, `package:check`, `lint:commands`, and `parity:check` with `parity: true`. Then
  the project's `checks` lines, a Bun job, and a gitleaks scan of the whole history. The shared workflow owns the CLI
  steps: the repository's `ci.yml` names a step it cannot run yet in `skip`, with the reason beside it, and puts only
  its extra checks in `checks` (tg and max: `pnpm check:agent-docs`).
- **Exceptions:** platform suites (Windows, macOS, install checks) are skipped here and run at release, monthly or on
  request. Nothing in this run publishes or tags. cli-docs runs its full validation before each deployment and monthly
  instead; community has no build to validate.
- **Applies to:** the CLIs, cli-base, cli-core and cli-testing. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-8 · Call cli-base `node-ci.yml` from `ci.yml`, pinned to a tag or commit

The pin and the installed package move apart. The shared workflows run the repository's own checkout and its
`pnpm` scripts, with the `@wirecat/cli-base` the lockfile installs; only the changelog guard runs a script from the
pinned commit. So the pin needs no fixed relation to the installed version. It may be newer, for example while
cli-core's peer range holds the installed package back; in a repository made from cli-template, Dependabot's weekly
`github-actions` update moves it like any other pinned action. The rules
that apply are those of the handbook in the installed package. A newer `node-ci.yml` may run a step the repository
cannot pass yet; the `skip` input names it.

The shared workflows are not in the npm package, because CI runs the pinned commit, not the installed copy. To see
what CI runs, an audit reads the `uses: WireCatLabs/cli-base/.github/workflows/…@<commit>` lines in `ci.yml`,
`release.yml` and `monthly.yml`, and opens each workflow file at that commit in cli-base. The fresh-agent audit on the
[New CLI](new-cli.md#done-when) page is given these files for this reason, beside the handbook and the repository;
its prompt in cli-template says so from cli-template 0.8.0. A CLI on an older template takes the prompt with
`upgrade`.

- **Why:** one shared workflow keeps the full suite the same everywhere, and a pin keeps a cli-base change from
  breaking every repository at once.
- **Enforced by:** `ci.yml:ci`.
- **Example:** `uses: WireCatLabs/cli-base/.github/workflows/node-ci.yml@<commit> # v0.31.0`, with `cli: true` for
  the CLI steps (WC-CI-7), the project's extra checks in the `checks` input and `bun-run` for the Bun job. A job that only one repository needs stays beside it in
  that repository's `ci.yml`.
- **Exceptions:** never pin to `main`. cli-base itself calls `./.github/workflows/node-ci.yml`. cli-docs has its own
  full workflow for the site, and community has none.
- **Applies to:** the CLIs, cli-core and cli-testing. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-9 · Run full validation and release security on the first day of each month, without publishing

- **Why:** a repository with no merges for weeks still meets new advisories, new runner images and expired pins.
- **Enforced by:** `monthly.yml:validation` · `monthly.yml:security`.
- **Example:** `monthly.yml`, from the community template, calls the repository's `ci.yml` and the pinned cli-base
  `release-checks.yml`. Each repository has its own minute, between 02:17 and 03:20 UTC, so runs do not overlap. No
  check compares the minutes across repositories; review keeps them apart. A CLI made from cli-template starts with
  the template's own minute and changes it (see [New CLI](new-cli.md)). Taken minutes, from each `monthly.yml` on
  the default branch:

  | UTC | Repository |
  |---|---|
  | 02:17 | cli-base |
  | 02:24 | whatsapp-cli |
  | 02:27 | gcal-cli |
  | 02:31 | cli-memo |
  | 02:38 | cli-core |
  | 02:45 | drive-cli |
  | 02:52 | cli-testing |
  | 02:59 | max-cli |
  | 03:02 | cli-template |
  | 03:06 | tg-cli |
  | 03:13 | zoom-cli |
  | 03:20 | cli-docs |

- **Exceptions:** cli-core also builds and probes its native packages in their own workflows, after the window:
  `onnx.yml` at 03:27 and `sqlite.yml` at 03:37 UTC. A scheduled run of either never publishes; only a manual run
  with `publish` does. community has no build, so it runs only the release security checks, at 03:47 UTC. A monthly
  run never publishes a package or deploys the site.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-10 · Run heavy security checks only at release, monthly or on request

- **Why:** a pull request needs a fast secret check; source scanners take minutes and find nothing new on most
  changes.
- **Enforced by:** `release.yml:checks` · `monthly.yml:security`.
- **Example:** cli-base `release-checks.yml` runs the production dependency audit, the workflow scan (`zizmor`),
  CodeQL and a full-history gitleaks scan. A release depends on it. A pull request runs the new-commit gitleaks scan
  in the standards job.
- **Exceptions:** the full-history gitleaks scan in `node-ci.yml` also runs on pull requests, through the validation
  job ([WC-CI-5](#wc-ci-5--run-the-full-linux-validation-on-every-pull-request-and-keep-platform-suites-out)); it
  takes seconds. The dependency audit, `zizmor` and CodeQL stay out. Do not add a heavy scanner to an editor hook, a
  stop hook or an ordinary pull request job.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** sc:9.

### WC-CI-11 · Moved to [WC-SECR-20](security.md#wc-secr-20--pin-each-third-party-action-to-a-commit-and-give-each-workflow-read-only-defaults)

### WC-CI-12 · Merge to `main` only through a pull request whose checks all passed

- **Why:** a red merge breaks `main` for every parallel branch, and an admin merge skips the only gate there is.
- **Enforced by:** `whatsapp-cli: main ruleset required checks` · `cli-core: main ruleset required checks` ·
  `tg-cli: main ruleset required checks` · `max-cli: main ruleset required checks` ·
  `cli-memo: main ruleset required checks` · `drive-cli: main ruleset required checks`, plus the main rulesets of
  cli-base and cli-template. In each repository with pr.yml, the ruleset requires the pull request validation jobs besides the
  standards job. cli-testing and cli-docs have no pr.yml, so their rulesets require only the standards job, and
  review covers the rest. zoom-cli has pr.yml,
  but its ruleset still requires only the standards job.
- **Example:** `gh pr checks <number>` shows every line as pass before `gh pr merge`. Never merge with `--admin`. A
  release changes `main` the same way
  ([WC-REL-2](releases.md#wc-rel-2--main-changes-only-through-a-pull-request-also-during-a-release)).
- **Exceptions:** none.
- **Applies to:** the WireCat repositories. **Since:** cli-base 0.41.0. **Rulings:** NEED-381.

### WC-CI-13 · Start no live messenger or account test from a workflow

- **Why:** a live test acts on a real account; only a person who chose to run it may start it.
- **Enforced by:** review only.
- **Example:** the offline contracts run in full validation. The live scenarios run only by hand, through the CLI's
  live-test procedure, on test accounts.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds. The procedures stay in their own homes.

- [community check schedule](https://github.com/WireCatLabs/community/blob/main/standards/CHECKS.md): the rough timings
- [cli-testing CI folder](https://github.com/WireCatLabs/cli-testing/tree/main/docs/ci): the cross-project timing
  table, the monthly runbook and the contract runner
