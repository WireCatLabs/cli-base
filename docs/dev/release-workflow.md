# Releasing from GitHub (Start release)

Status: proposed. No repository calls it yet; `bin/release` still works and stays until every CLI has moved.

[`release-start.yml`](../../.github/workflows/release-start.yml) is a reusable workflow. Each CLI adds a small
`release-start.yml` with a **Run workflow** button that calls it. One run does what `bin/release` did on a laptop:

1. Refuses a run from any branch but `main`, and a `main` whose tag `v<version>` is already this commit.
2. `cli-dev changelog restore`: entries that missed the last release go back to Unreleased.
3. `cli-dev changelog fold`, when the dated version is not on npm yet: Unreleased joins it.
4. `cli-dev next-version`: when npm already has the version, or a higher one, it raises `package.json`,
   `src/version.ts` (if present) and the changelog heading. An `after-raise` command runs next (whatsapp-cli syncs
   its engine packages there).
5. Requires a dated top section and a version that is not on npm. Runs the `check` command (for example the
   live check, WC-REL-17).
6. If steps 2 to 4 changed files: one pull request `chore(release): <version>`, merged when GitHub says it can merge
   (below). Otherwise nothing lands.
7. Starts the repository's own `release.yml` with `commit=<merged sha>` and follows it to the end.

`release.yml` stays the only workflow that publishes. npm's trusted publishing checks the file name of the
top-level workflow, which for a reusable workflow is the caller
([npm: trusted publishers, troubleshooting](https://docs.npmjs.com/trusted-publishers#troubleshooting)). Moving the
publish into cli-base would mean re-registering nine packages on npmjs.com. Provenance is attached automatically
([npm: automatic provenance](https://docs.npmjs.com/trusted-publishers#automatic-provenance-generation)).

## Tokens

| Step | Token | Why |
|---|---|---|
| push the branch, open and merge the pull request | GitHub App installation token | A pull request opened with `GITHUB_TOKEN` runs its `pull_request` workflows only after someone clicks "Approve workflows to run", so the required checks would not report on their own ([GitHub: GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs)). A merge pushed with `GITHUB_TOKEN` would also not start `main.yml`. |
| start `release.yml` | `GITHUB_TOKEN` with `actions: write` | `workflow_dispatch` always creates a run, even from `GITHUB_TOKEN` (same page). |
| publish to npm | none (OIDC, inside `release.yml`) | unchanged |

An App, not a personal access token: its token lives an hour, is limited to the repositories it is installed on
and to the permissions the step asks for (`contents: write`, `pull-requests: write`), and does not act as the
owner ([GitHub: authenticating with an App in Actions](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow),
[actions/create-github-app-token](https://github.com/actions/create-github-app-token)).

### What the owner sets up once

1. A GitHub App owned by WireCatLabs (e.g. `wirecat-release`), no webhook, repository permissions
   **Contents: read and write**, **Pull requests: read and write**. Install it on the nine repositories.
2. Organization variable `RELEASE_APP_CLIENT_ID` (the App's client ID, not its app ID) and organization secret
   `RELEASE_APP_PRIVATE_KEY` (the private key file's contents), both visible to the nine repositories.
3. Nothing in the rulesets: the pull request rule requires 0 approvals, and the workflow merges like a person does.
   Check once that `require_extra_approval_for_unattributed_changes` (on in every ruleset) does not hold a pull
   request whose commits an App made; if it does, the App needs a bypass on the pull request rule.

## Waiting for checks (DEBT-259, BUG-565)

The workflow waits on GitHub's own merge state, not on a list of checks. Every 10 seconds, up to 30 minutes:

- `gh pr checks --required` exits 1: a required check failed. Stop, nothing published.
- `mergeStateStatus` is `CLEAN`, `HAS_HOOKS` or `UNSTABLE` (`UNSTABLE` = only optional checks fail, such as a
  Windows ARM job with no runner): merge with `--match-head-commit`. A refused merge is retried on the next turn.
- `DIRTY`, or the pull request closed: stop.

Waiting on the merge state covers the race of BUG-565, where `gh pr checks --watch` returned before every
required check had registered. Before the merge it also checks that `main` has not moved since the run started,
as `bin/release` did. Native auto-merge (`gh pr merge --auto`) would be simpler, but it needs **Allow auto-merge**,
which is off in the repositories today
([GitHub: auto-merge](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request)).

## One release at a time

The `prepare` job uses the concurrency group `release-start-<repository>` and `release.yml` keeps its own `release`
group. GitHub keeps at most one run pending per group and cancels an older pending one when a newer one arrives
([GitHub: concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)).
Two clicks therefore give one running release and one waiting one, which finds the version already on npm and
raises the next.

## Failure and resume

Every step is safe to run again: restore and fold change nothing the second time, a version npm has is raised, and
a tag at `HEAD` stops the run. So the answer to any failure is to fix the cause and press the button again.

- Checks failed or timed out: the pull request stays open on `release/<version>-<run id>`. Close it; the next run
  opens its own branch (the run id keeps the names apart).
- Merged, but `release.yml` failed: `main` already has the version. The next run makes no pull request and starts
  `release.yml` on the same commit.
- `release.yml` refuses because `main` moved after the merge (its `checked-commit` job): run again.

## cli-core's inputs

cli-core's `release.yml` takes `commit` and `app_ref`. The caller passes `app_ref` through `release-inputs`
(`{"app_ref": "${{ inputs.app_ref }}"}`) and keeps it as its own `workflow_dispatch` input. `commit` is always the
merged commit. cli-memo's and cli-base's `release.yml` do not take `commit` yet: they set `pass-commit: false` until
they get the same `checked-commit` job.

## Caller

```yaml
name: Start release
on:
  workflow_dispatch:
permissions: {}
jobs:
  release:
    permissions:
      contents: read
      actions: write
    uses: WireCatLabs/cli-base/.github/workflows/release-start.yml@<sha> # vX.Y.Z
    with:
      app-client-id: ${{ vars.RELEASE_APP_CLIENT_ID }}
    secrets:
      app-private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}
```

Per repository: `cli-dev` (repositories without cli-base as a dependency use `npx -y -p @wirecat/cli-base@x.y.z
cli-dev`), `unreleased` (max-cli: `Не выпущено`), `check`, `after-raise`, `release-inputs`.

## Open

- cli-base releases itself with `node dist/dev/bin.js` after a build; `cli-dev` here is one command, so cli-base's
  caller needs a `pnpm exec cli-dev` that resolves to its own build, or a build step input.
- cli-template raises with `scripts/version-level.ts --next` after `cli-dev next-version`; this workflow uses only
  `cli-dev next-version`. Either the script moves into `cli-dev` or cli-template keeps a difference.
- Local `bin/release` ran `pnpm release:check` before starting `release.yml`; here `release.yml`'s own validation is
  the check. `bin/release --local` (first publish of a new package) has no GitHub equivalent and stays a script.
