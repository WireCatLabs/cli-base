# CI

## Scope

What runs where: the local hooks, the checks on every pull request and their time budget, full validation on each
merge to `main`, and the monthly runs.

Rule ids on this page are `WC-CI-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md). What each tool checks is on the [Toolchain page](toolchain.md); the release workflow is on the
[Releases page](releases.md).

The procedures stay in their own homes: the
[community check schedule](https://github.com/WireCatLabs/community/blob/main/standards/CHECKS.md) has the rough
timings, and the [cli-testing CI folder](https://github.com/WireCatLabs/cli-testing/tree/main/docs/ci) has the
cross-project timing table, the monthly runbook and the contract runner.

"The ten repositories" on this page means the six CLIs (tg, max, memo, drive, zoom, wa), cli-base, cli-core,
cli-testing, cli-docs, plus community itself.

## Rules

### WC-CI-1 · Run only staged lint and a staged secret scan before a commit

- **Why:** a hook that takes more than a second makes people skip it, which is worse than a small hook.
- **Enforced by:** `pnpm standards:check` · `standards.yml:standards`.
- **Example:** the shared `lefthook` config runs, in parallel, Biome on the staged files and
  `gitleaks git --staged --redact`. A clone without gitleaks gets a warning and can still commit; CI scans anyway.
  The `prepare` script installs the hooks; `LEFTHOOK=0 git commit` skips them for one commit.
- **Exceptions:** none.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-2 · Add no push hook, and no hook that installs, builds, checks types, generates or tests

- **Why:** every check in a hook runs again in CI, so a slow hook only costs time and teaches people to bypass hooks.
- **Enforced by:** review only.
- **Example:** a repository's `lefthook.yml` holds only the `extends` line for `config/wirecat/lefthook.yml`. An agent
  does not run `standards:check`, the full lint, spelling, a build or the test suite on each commit or push; it runs a
  targeted check when it needs one.
- **Exceptions:** none. cli-base `config/lefthook.yml` still has a pre-push typecheck, but no repository extends it.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-3 · Run the fast standards job on every pull request and every push to `main`

- **Why:** it catches broken presets, lint, Markdown, types and new secrets in well under a minute, before review.
- **Enforced by:** `standards.yml:standards`.
- **Example:** the job does one cached install with lifecycle scripts off, then runs `pnpm standards:check`,
  `pnpm lint`, `pnpm docs:lint`, `pnpm run --if-present ci:quick` and a gitleaks scan of the new commits only. A new
  commit cancels the run it replaces. The job times out after five minutes, a ceiling for a stalled setup, not an
  expected time.
- **Exceptions:** none. Runner queues and cold downloads are outside the budget.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-4 · Keep `ci:quick` to early bug checks that finish within two minutes

- **Why:** it is the only build-level check on a pull request, so it must stay fast enough that nobody wants it gone.
- **Enforced by:** `standards.yml:standards` · `pnpm ci:quick`.
- **Example:** what each repository runs today:
  - tg, max, memo and wa: `pnpm typecheck && pnpm build && pnpm lint:commands`;
  - drive: `pnpm typecheck && pnpm lint:commands`, which builds first;
  - zoom, cli-base and cli-testing: `pnpm typecheck`;
  - cli-core: `pnpm typecheck` and its command lint test;
  - cli-docs: its unit tests, without the one that needs generated pages;
  - community: its script tests.
- **Exceptions:** never put live-account suites, agent suites, full tests, coverage or platform jobs here.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-5 · Keep full tests, builds of documents, parity and platform suites out of pull request CI

- **Why:** pull request CI is the step people wait on; the heavy suites run once on `main`, where a failure still
  shows within minutes of the merge.
- **Enforced by:** review only.
- **Example:** on a pull request, only the standards job, the changelog guard and small path-scoped jobs run. Coverage,
  contracts, the test matrix, `docs:check`, parity, Windows and macOS run in full validation (WC-CI-7).
- **Exceptions:** a path-scoped job that tests one platform-specific file may run on pull requests, such as cli-base
  `macos.yml` for the path code. cli-docs and community run `security-pr.yml`, a new-commit secret scan. Third-party
  security apps may post their own checks.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-6 · Run the changelog guard on every pull request

- **Why:** a breaking change without a changelog line reaches callers with no warning.
- **Enforced by:** `changelog-guard.yml:guard`.
- **Example:** each repository's `changelog-guard.yml` calls
  `WireCatLabs/cli-base/.github/workflows/changelog-guard.yml` at a pinned commit, on `opened`, `edited`,
  `synchronize` and `reopened`. The changelog rules it applies are on the [Documents page](docs.md).
- **Exceptions:** cli-testing, cli-docs and community have no changelog guard yet.
- **Applies to:** the CLIs, cli-base and cli-core. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-7 · Run full validation once on each merge to `main`, on Linux, without publishing

- **Why:** a merge that breaks the full suite shows up the same hour, not at the next release.
- **Enforced by:** `main.yml:validation` · `node-ci.yml:check` · `node-ci.yml:bun` · `node-ci.yml:secrets`.
- **Example:** `main.yml` calls the repository's own `ci.yml`, which calls cli-base `node-ci.yml`. That runs
  `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm build`, then the project's `checks` lines (for max:
  contracts, the no-leak scan, the version check, `pnpm generate` and `git diff --exit-code`, the test matrix,
  `docs:check` and parity), a Bun job, and a gitleaks scan of the whole history.
- **Exceptions:** platform suites (Windows, macOS, install checks) are skipped here and run at release, monthly or on
  request. Nothing in this run publishes or tags. cli-docs runs its full validation before each deployment and monthly
  instead; community has no build to validate.
- **Applies to:** the CLIs, cli-base, cli-core and cli-testing. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-8 · Call cli-base `node-ci.yml` from `ci.yml`, pinned to a tag or commit

- **Why:** one shared workflow keeps the full suite the same everywhere, and a pin keeps a cli-base change from
  breaking ten repositories at once.
- **Enforced by:** `ci.yml:ci`.
- **Example:** `uses: WireCatLabs/cli-base/.github/workflows/node-ci.yml@<commit> # v0.31.0`, with the project's own
  checks in the `checks` input and `bun-run` for the Bun job. A job that only one repository needs stays beside it in
  that repository's `ci.yml`.
- **Exceptions:** never pin to `main`. cli-base itself calls `./.github/workflows/node-ci.yml`. cli-docs has its own
  full workflow for the site, and community has none.
- **Applies to:** the CLIs, cli-core and cli-testing. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-9 · Run full validation and release security on the first day of each month, without publishing

- **Why:** a repository with no merges for weeks still meets new advisories, new runner images and expired pins.
- **Enforced by:** `monthly.yml:validation` · `monthly.yml:security`.
- **Example:** `monthly.yml`, from the community template, calls the repository's `ci.yml` and the pinned cli-base
  `release-checks.yml`. Each repository has its own minute, between 02:17 and 03:21 UTC, so runs do not overlap.
- **Exceptions:** community has no build, so it runs only the release security checks, at 03:47 UTC. A monthly run
  never publishes a package or deploys the site.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-10 · Run heavy security checks only at release, monthly or on request

- **Why:** a pull request needs a fast secret check; source scanners take minutes and find nothing new on most
  changes.
- **Enforced by:** `release.yml:checks` · `monthly.yml:security`.
- **Example:** cli-base `release-checks.yml` runs the production dependency audit, the workflow scan (`zizmor`),
  CodeQL and a full-history gitleaks scan. A release depends on it. A pull request runs only the new-commit gitleaks
  scan in the standards job.
- **Exceptions:** none. Do not add a heavy scanner to an editor hook, a stop hook or an ordinary pull request job.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** sc:9.

### WC-CI-11 · Pin each third-party action to a commit and give each workflow read-only defaults

- **Why:** a moved tag or a write token in a workflow is how an outside change reaches a release.
- **Enforced by:** review only.
- **Example:** `uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` with
  `persist-credentials: false`, and `permissions: contents: read` at the top of the workflow. A job that needs more
  asks for it on that job only. The `zizmor` scan in `release-checks.yml` reports high findings at release, but does
  not fail on them.
- **Exceptions:** none.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CI-12 · Merge to `main` only through a pull request whose checks all passed

- **Why:** a red merge breaks `main` for every parallel branch, and an admin merge skips the only gate there is.
- **Enforced by:** review only.
- **Example:** `gh pr checks <number>` shows every line as pass before `gh pr merge`. Never merge with `--admin`.
- **Exceptions:** none.
- **Applies to:** the ten repositories. **Since:** cli-base 0.41.0. **Rulings:** NEED-381.

### WC-CI-13 · Start no live messenger or account test from a workflow

- **Why:** a live test acts on a real account; only a person who chose to run it may start it.
- **Enforced by:** review only.
- **Example:** the offline contracts run in full validation. The live scenarios run only by hand, through the CLI's
  live-test procedure, on test accounts.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.
