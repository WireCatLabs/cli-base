# Releases

<!-- cspell:ignore flock lslocks OIDC whatsapp zizmor -->

## Scope

How a CLI is released: `bin/release`, the release lock, version numbers, the owner's yes and trusted publishing.

Rule ids on this page are `WC-REL-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md). The changelog a release dates is on the [Documents](docs.md) page. The checks a release runs are
on the [CI](ci.md) page.

## Rules

### WC-REL-1 · Release only with `bin/release`, from a clean `main` that matches `origin/main`

- **Why:** the workflow publishes `origin/main`, so a local commit or a dirty tree would not ship what was checked.
- **Enforced by:** `<app>: bin/release`.
- **Example:** raise `version` in `package.json` and date the pending changelog section in a pull request. Merge it.
  Then run `bin/release` on `main`. It refuses another branch, uncommitted changes and a `main` ahead of
  `origin/main`.
- **Exceptions:** none.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-REL-2 · `main` changes only through a pull request, also during a release

- **Why:** the repository ruleset requires it, and every change to `main` then passes the pull request checks.
- **Enforced by:** review only.
- **Example:** when `bin/release` renumbers the version or folds the changelog, it opens a pull request, waits for its
  checks and merges it before it publishes. The merge rule itself is
  [WC-CI-12](ci.md#wc-ci-12--merge-to-main-only-through-a-pull-request-whose-checks-all-passed).
- **Exceptions:** none.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-REL-3 · `bin/release` takes its package's release lock before it builds or publishes

- **Why:** two sessions published the same package at the same time on one machine. Different packages do not
  conflict, so each package has its own lock and they release side by side.
- **Enforced by:** `<app>: bin/release`.
- **Example:**

  ```sh
  . ./config/wirecat/release-lock.sh
  wirecat_release_lock
  ```

  The helper comes from the community presets (`adopt-standards.py --only release-lock`). It holds
  `${XDG_RUNTIME_DIR:-/tmp}/wirecat-release-<key>.lock` with `flock` on file descriptor 9 until the release ends.
  `<key>` is the `name` in `package.json`, made safe for a file name: `@wirecat/cli-core` locks
  `wirecat-release-wirecat-cli-core.lock`. The key is the package, not the folder, so every checkout and worktree
  of one package shares the lock. A `package.json` without a name refuses the release.
- **Exceptions:** none.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** NEED-854, ASK-336.

### WC-REL-4 · Never break the release lock; wait for the holder and try again

- **Why:** a deleted lock file is a new file, so a second release can then run at the same time as the first.
- **Enforced by:** review only.
- **Example:** when the lock is held, the helper names the holder on stderr. Let that release finish, then run
  `bin/release` again. Do not delete the lock file and do not kill the holder.
- **Exceptions:** none. A missing `lslocks` or an old holder label does not allow a release; only `flock` decides.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-REL-5 · One releaser per version: npm decides which number is free

- **Why:** two sessions often prepare the same number; the second must not publish over the first or fail late.
- **Enforced by:** `tg-cli: bin/release` · `max-cli: bin/release` · `whatsapp-cli: bin/release` ·
  `cli-memo: bin/release` · `gcal-cli: bin/release`.
- **Example:** before it publishes, `bin/release` asks npm. When npm already has the version, or a higher one, it
  takes the next free number at the same level (after `x.y.0` the next minor, else the next patch). It lands that
  number through a pull request and publishes it.
- **Exceptions:** a pre-release version is chosen by hand. drive's and zoom's `bin/release` do not renumber yet: they
  refuse a version npm already has.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-REL-6 · `package.json` holds the version, and the program reads a synced copy

- **Why:** a bundled command has no `package.json` to read, so `--version` reads a source file that must not drift.
- **Enforced by:** `node-ci.yml:check` · `<app>: pnpm version:check` · `whatsapp-cli: pnpm version:check`.
- **Example:** edit only `package.json`, then run `pnpm version:sync` to update `src/version.ts`. `pnpm version:check`
  fails when the two disagree.
- **Exceptions:** a shared library that prints no version has no `src/version.ts`.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-REL-7 · Versions are `x.y.z`; before 1.0.0 a breaking change raises the minor

- **Why:** npm's `^0.40.4` takes every `0.40.x`, so a patch reaches callers who never read its changelog. It must not
  break them.
- **Enforced by:** review only.
- **Example:** raise the minor (`0.40.4` to `0.41.0`) for a release with a new feature or with any entry under
  "Changed — may break callers" or "Removed". Raise the patch (`0.40.4` to `0.40.5`) only when every entry is a fix
  or a change to the documents.
- **Exceptions:** a pre-release version (`0.41.0-rc.1`) is chosen by hand.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-REL-8 · Any package may release at any time

- **Why:** a wait between releases or a weekly limit on breaking changes only delays a fix; the owner removed both
  limits on 2026-10-24.
- **Enforced by:** review only.
- **Example:** tg-cli can release an hour after its last version, and cli-core can ship a breaking change on the same
  day as the previous one. Bump the library in every CLI that uses it on the day it ships.
- **Exceptions:** none. The release lock (WC-REL-3) still keeps two releases of one package on one machine from
  running at once.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.51.1. **Rulings:** NEED-1741.

### WC-REL-9 · Merged into [WC-REL-8](#wc-rel-8--any-package-may-release-at-any-time)

### WC-REL-10 · A messenger CLI is released only after the owner says yes in the conversation

- **Why:** a messenger CLI acts on the owner's own accounts, so the owner decides when a new version ships. A signed
  release report added a step without adding a check: the owner removed it on 2026-10-31 ("remove the signing
  requirements instead just ask").
- **Enforced by:** review only.
- **Example:** the agent finishes the release skill, then asks "release max 0.91.0?". It runs `bin/release` only after
  the owner says yes for that version. One yes covers one version.
- **Exceptions:** none.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** owner, 2026-10-31.

### WC-REL-11 · Publish from GitHub Actions with npm trusted publishing

- **Why:** no npm token is stored in GitHub, and npm attaches provenance to the package.
- **Enforced by:** `release.yml:publish`.
- **Example:** `bin/release` starts `release.yml` and follows it. Only the `publish` job has the OIDC permission (the
  short-lived identity npm trusts), and it runs no project code: it only runs `npm publish` on the validated file.
- **Exceptions:** npm trusts the workflow by file name: renaming `release.yml` stops publishing until npm's trusted
  publisher settings are updated. npm sets a trusted publisher on the package's settings page
  ([npm docs](https://docs.npmjs.com/trusted-publishers)), which a package has only once it is published, so its
  first version is published with `bin/release --local` by the owner, from a clean `main`. Right after it, the owner
  adds the trusted publisher on npmjs.com (step 2 of [New CLI](new-cli.md#four-steps-that-need-a-person)), and every
  later version goes through `release.yml`. ClawHub has no trusted publishing: the `clawhub` job publishes the agent
  skill with the organization secret `CLAWHUB_TOKEN`. It runs after the tag, so a ClawHub failure never holds back
  npm; the run then fails although npm and the tag are done, and only that job is run again.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-REL-12 · Publish only after full validation and the release security checks pass

- **Why:** pull request checks are bounded; the full suite and the heavy scanners run before anything reaches npm.
- **Enforced by:** `release.yml` · `release-checks.yml`.
- **Example:** `release.yml` runs full validation and `release-checks.yml` (dependency audit, workflow analysis with
  zizmor, CodeQL). Validation packs the package once, and the `build` job checks that file's SHA-256 before it is
  handed to `publish`. A CLI that publishes several packages packs every one of them once, records each file's
  SHA-256, and checks each before it is published: wa publishes its main package and six platform packages of its
  Go engine.
- **Exceptions:** none.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-REL-13 · Tag `v<version>` only after npm shows that version

- **Why:** a tag for a version npm does not have yet marks a release that may still fail.
- **Enforced by:** `release.yml:tag`.
- **Example:** the `publish` job waits until npm serves the new version; only then does the `tag` job push
  `v<version>`. In the CLIs, the workflow also creates the GitHub release from that version's changelog section.
- **Exceptions:** none.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-REL-14 · `bin/release --local` is the fallback, and it never prints the npm token

- **Why:** a release must still be possible when GitHub Actions is down, without leaking the token.
- **Enforced by:** `tg-cli: bin/release` · `max-cli: bin/release` · `whatsapp-cli: bin/release` ·
  `cli-memo: bin/release` · `gcal-cli: bin/release`.
- **Example:** `bin/release --local` runs the same checks on this machine and reads the npm token from the keyring
  into the publish command's environment. The checks include the test suite with its coverage floor,
  any shipped non-JavaScript engine's tests, offline contracts, leak and secret scans, and dependency
  vulnerability audits for each shipped language. Build and validate before supplying the token to the
  publish process; publishing must not run unchecked lifecycle scripts with it. Neither success nor an
  error prints the token.
- **Exceptions:** none. drive's and zoom's `bin/release` have no `--local` yet.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-REL-15 · Fold a late pending section into the unpublished version before publishing

- **Why:** a pull request merged after the version was dated adds a pending section above it, and that change must
  ship in the version it lands in.
- **Enforced by:** review only.
- **Example:** `bin/release` first runs `cli-dev changelog restore --land`. It compares the newest tagged version's
  section with its text in the tag: a pull request checked before that release and merged after it put its entry
  there, though its code ships only now. The section goes back to the tag's text and the entry moves to the pending
  section, through a pull request. Then, while npm does not have the version, `bin/release` runs
  `cli-dev changelog fold --land --version <x.y.z>`. It folds the pending section into the dated one, and merges any
  repeated `###` heading, through a pull request.
- **Exceptions:** only the newest tag is compared; an older section that differs from its tag stays as it is. A
  newest tag whose changelog has no section of its own has nothing to restore: the command says so and changes
  nothing.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-REL-16 · The package ships only the files it names

A CLI's `files` holds only what the installed CLI runs from or shows its user: `dist`, the agent skill (`skills`),
`README.md`, `LICENSE`, and files its code reads or runs after install, such as `scenarios` for `guide`, an `install`
script, third-party notices and licenses. `CHANGELOG.md` may ship too. It never holds `src/`, tests, fakes or
fixtures, `scripts/`, `.github/`, `bin/release`, `config/`, `lint/`, `contracts/`, `docs/dev/` or `template.json`.

- **Why:** a stray file in the package can leak local data and grows every install.
- **Enforced by:** `node-ci.yml:check` · `<app>: pnpm package:check` · `whatsapp-cli: pnpm release:check`.
- **Example:** `package.json` `files` lists what ships. `packContents(root, allowed, said)` from
  `@wirecat/cli-base/release` fails on any path in `npm pack --dry-run` outside `allowed`. It checks the pack against
  the list it is given, not against this rule: a CLI that passes its own `files` list as `allowed`, as the template's
  `scripts/smoke.ts` does, checks only that npm packs what `files` says, and cannot fail on a wrong `files` list.
  `npm pack --dry-run` in gcal-cli packed 256 files on 2026-10-27, `src/`, `scripts/`, `.github/`, `config/`,
  `contracts/`, `lint/` and `template.json` among them, because its `files` list named them; its check could not see
  it. On 2026-10-31 (gcal-cli 0.2.0) it packs 144. The check this rule needs
  refuses the forbidden paths above whatever `files` says: cli-template's `scripts/smoke.ts` does since
  [cli-template#85](https://github.com/WireCatLabs/cli-template/pull/85). `scripts/` is a seed that `upgrade` never
  changes, so a CLI made before it copies the check by hand.
- **Exceptions:** cli-template's own package ships the skeleton's sources and configs, since `new` copies them; the
  `files` list `new` writes into a CLI follows this rule. Each CLI's `package:check` runs `packContents`; tg and max
  as `release-check.ts --package-only`.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-base `RELEASING.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/dev/RELEASING.md), the step by step
  for cli-base itself
- [community standards, "Release locking"](https://github.com/WireCatLabs/community/blob/main/standards/README.md),
  the how-to for installing the lock helper
- each CLI's `bin/release` and its release skill, which carry out these rules
