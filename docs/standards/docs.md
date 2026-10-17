# Documents

<!-- cspell:ignore whatsapp -->

## Scope

How documents are written: user pages and developer pages, generated pages, current facts only, languages, and the
changelog.

Rule ids on this page are `WC-DOC-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

## Rules

### WC-DOC-1 · Keep user pages and developer pages apart

- **Why:** a user page is read to do a task; a developer page is read to change the code. Mixed pages serve neither.
- **Enforced by:** review only.
- **Example:** `README.md` and `docs/*.md` are user pages. `docs/dev/*.md`, `CLAUDE.md`, `AGENTS.md` and
  `SECURITY.md` are developer pages.
- **Exceptions:** `CHANGELOG.md` is read by users and has its own rules (WC-DOC-14 to WC-DOC-20).
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-2 · A user page has no correction marks, no struck-out text and no internal ids

- **Why:** the reader wants the current behaviour, not the history of a page or a journal number they cannot open.
- **Enforced by:** `tg-cli: pnpm docs:check` · `max-cli: pnpm docs:check` · `whatsapp-cli: pnpm docs:check` ·
  `zoom-cli: pnpm docs:check`.
- **Example:** write "`--limit` defaults to 50", not "~~20~~ 50 (correction 2026-10-01, NEED-12)".
- **Exceptions:** none. `cli-dev docs-check` checks this when the CLI's rules module sets `userPage`. tg, max, wa
  and zoom set it; memo, drive and cli-base's default check do not.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-3 · Every document states current facts; rewrite a wrong sentence in place

- **Why:** a confidently stale document causes a wrong decision; git already keeps the old text.
- **Enforced by:** review only.
- **Example:** a claim that turns out wrong is rewritten to the current fact, with no "correction" note and no dated
  "measured on" trail. A finished plan or handoff is deleted. A done backlog or cleanup line is deleted.
- **Exceptions:** `CHANGELOG.md` is the one place with version history.
- **Applies to:** all CLIs, user and developer pages. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-4 · A generated page is never edited by hand

- **Why:** the next generation overwrites a hand edit, and the page then disagrees with the program until it does.
- **Enforced by:** `cli-memo: pnpm generate:check` · `drive-cli: pnpm generate:check` ·
  `zoom-cli: pnpm generate:check` · `tg-cli: ci.yml:ci` · `max-cli: ci.yml:ci` · `whatsapp-cli: ci.yml:ci`.
- **Example:** `docs/commands.md` comes from the program. Change the command's help text, then run `pnpm generate`.
- **Exceptions:** none. memo, drive and zoom check this with `pnpm generate:check`. tg, max and wa run the generator
  and then `git diff --exit-code` in full validation.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-5 · Every relative link and anchor resolves

- **Why:** a broken link sends the reader nowhere at the moment they need the next step.
- **Enforced by:** `pnpm docs:check`.
- **Example:** `cli-dev docs-check` fails on `[setup](usage.md#setup)` when `usage.md` has no "Setup" heading.
- **Exceptions:** a link into a private checkout that CI does not have (for example `docs_ai/`) is skipped by the CLI's
  rules module.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-6 · The `docs/` folder matches `docs/meta.json` and has the shared page set

- **Why:** every tool has the same pages at the same addresses, so a reader who knows one tool knows them all.
- **Enforced by:** `max-cli: pnpm docs:check` · `whatsapp-cli: pnpm docs:check` · `tg-cli: pnpm docs:check`.
- **Example:** `docs/meta.json` lists every page once, in sidebar order. The folder has `index`, `installation`,
  `usage`, `commands`, `configuration`, `troubleshooting` and `security`. Each page has exactly one `#` heading.
- **Exceptions:** `changelog` in `meta.json` comes from the root `CHANGELOG.md`. `cli-dev docs-check --pages` checks
  this. max and wa run it, and tg runs the same check in its own `scripts/docs-check.ts`. memo, drive and zoom do not
  yet.
- **Applies to:** every CLI in the docs portal. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-7 · `README.md` is the full introduction to the tool

- **Why:** most readers open only the README; it must take them from "what is this" to a first result.
- **Enforced by:** review only.
- **Example:** follow max-cli's README order: quick start, what you can do, for AI agents, why this tool, the main
  features, sign-in and profiles, settings and permissions, limits, security, when it does not work, documentation,
  development.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-500.

### WC-DOC-8 · A user guide follows the portal's authoring and terminology rules

- **Why:** one vocabulary and one page shape across tools; the portal copies these pages as they are.
- **Enforced by:** review only.
- **Example:** a guide opens with when to use it and what result the reader gets, then the steps. It says "agent",
  not "assistant" or "model". See cli-docs `AUTHORING.md` and `TERMINOLOGY.md`.
- **Exceptions:** reference pages, such as the generated `commands.md`, follow their generator.
- **Applies to:** every CLI in the docs portal. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-9 · A tool's security page links the shared page and keeps only what is its own

- **Why:** shared behaviour written in each tool drifts; the reader needs only what differs for this tool.
- **Enforced by:** review only.
- **Example:** `docs/security.md` links the portal's shared security page, then states what this messenger stores and
  sends.
- **Exceptions:** none.
- **Applies to:** every CLI in the docs portal. **Since:** cli-base 0.41.0. **Rulings:** NEED-556.

### WC-DOC-10 · One fact has one home; every other document links to it

- **Why:** two copies of a fact drift, and the reader cannot tell which one is current.
- **Enforced by:** review only.
- **Example:** a rule lives on its handbook page; a repository's `CLAUDE.md` links the page instead of restating the
  rule. A task lives in the backlog; a plan links it.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-11 · A developer page anchors each claim and says how it was verified

- **Why:** a claim with no source cannot be checked when the code or the service changes.
- **Enforced by:** review only.
- **Example:** cite `src/store/open.ts:42` for our code, a URL for anything outside, a commit for history. Write "ran
  X, saw Y" for what you ran, and "the docs describe X" for what you only read. Say at the top what is not verified.
- **Exceptions:** user pages state behaviour and do not carry code anchors.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-12 · A runnable command in a document has no placeholder in it

- **Why:** a placeholder such as `<your-chat-id>` gets pasted as it is and runs against the wrong thing.
- **Enforced by:** review only.
- **Example:** paste a real value from a real run, or an obviously synthetic one that is labelled as such. Ask for a
  value in a plain sentence before the command.
- **Exceptions:** syntax lines in a reference page, which are not meant to be run.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-13 · Each file is in one language, and each repository has a fixed document language

- **Why:** a reader and the spell checker both handle one language per file.
- **Enforced by:** review only.
- **Example:** English everywhere, except max-cli: its user pages, its changelog and its new documents are Russian.
  A section added to an existing file follows that file's language.
- **Exceptions:** command names, option names and quoted output stay as the program prints them.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-14 · `CHANGELOG.md` has one section per version, newest first, under a pending section

- **Why:** the GitHub release and the release scripts read the changelog by its headings.
- **Enforced by:** `pnpm docs:check` · `changelog-guard.yml`.
- **Example:** `## Unreleased` at the top while work is merged; a release dates it as `## 0.41.0 — 17.10.2026`. Each
  version heading and the pending heading appear once.
- **Exceptions:** max-cli names the pending section `## Не выпущено`.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-15 · Changelog entries go under five fixed headings, each at most once per section

- **Why:** one heading set lets a reader, an agent and one guard read every repository the same way.
- **Enforced by:** `pnpm docs:check` · `changelog-guard.yml`.
- **Example:** `### Added`, `### Changed — may break callers`, `### Fixed`, `### Security`, `### Removed`. max-cli
  uses this fixed Russian rendering: `Что нового`, `Изменено — может сломать скрипты`, `Исправлено`, `Безопасность`,
  `Удалено`.
- **Exceptions:** a released section keeps the headings it was released with, because it is never edited
  ([WC-DOC-20](#wc-doc-20--a-released-section-is-frozen-and-a-new-entry-goes-under-an-existing-heading)). A CLI that
  moves to this set puts its last version with the old headings in its changelog rules as
  `legacyHeadingsThrough: "<version>"`, and the check skips heading names and repeats in every section at or below
  that version. tg-cli keeps the old headings up to 0.69.0, still with its own copy of that rename. memo still
  writes `Changed — may break scripts`, `Documentation` and `Deprecated`, and drive writes `Changed`. Neither runs
  this check yet; they move to this set.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-16 · A change a caller may notice goes under "Changed — may break callers"

- **Why:** this heading is what a reader scans before an upgrade.
- **Enforced by:** review only.
- **Example:** a changed output field, exit code, option, permission or config key, or a changed exported signature
  in a shared library. The entry says what each caller has to do.
- **Exceptions:** none.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-17 · Each entry says what changed for the caller, why, and what to watch for

- **Why:** a line that only names the change leaves the reader unable to decide whether it touches them.
- **Enforced by:** review only.
- **Example:** "**`chats list` sorts by the last message.** It sorted by name before. A script that needs the old
  order passes `--sort name`." The bold lead is a whole sentence. No file paths or internal names a caller cannot
  see; link the page that describes it.
- **Exceptions:** "why" is left out when it is obvious, such as a new command.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-18 · The changelog has no internal ids

- **Why:** a journal, backlog or ruling id means nothing to a reader outside the project.
- **Enforced by:** `pnpm docs:check`.
- **Example:** `cli-dev docs-check` fails on `NEED-12` or `TASK-3` anywhere in `CHANGELOG.md`.
- **Exceptions:** none.
- **Applies to:** all CLIs and shared libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-19 · A pull request with a breaking title adds an entry to the pending section

- **Why:** a breaking change with no changelog line reaches callers with no warning.
- **Enforced by:** `changelog-guard.yml`.
- **Example:** a title `feat(store)!: …` fails the guard unless the pull request adds a line under `## Unreleased`.
- **Exceptions:** none.
- **Applies to:** every repository that calls the changelog guard. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-DOC-20 · A released section is frozen, and a new entry goes under an existing heading

- **Why:** a release's notes must match what shipped, and one section with two `### Fixed` headings reads as two
  lists.
- **Enforced by:** `changelog-guard.yml`.
- **Example:** the guard fails a change to a section whose `v<version>` tag exists, unless the change restores the
  exact text in that tag. It also fails a new repeated `###` heading in any section that has no tag yet.
- **Exceptions:** a dated section with no tag is still open to fixes; a release is tagged only after npm has it.
- **Applies to:** every repository that calls the changelog guard. **Since:** cli-base 0.41.0. **Rulings:** none.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-base `CONVENTIONS.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/dev/CONVENTIONS.md)
- [max-cli `CONVENTIONS.md`](https://github.com/WireCatLabs/max-cli/blob/main/docs/dev/CONVENTIONS.md), sections
  "Documents" and "The changelog"
- [cli-docs `STRUCTURE.md`](https://github.com/WireCatLabs/cli-docs/blob/main/docs/STRUCTURE.md),
  [`AUTHORING.md`](https://github.com/WireCatLabs/cli-docs/blob/main/docs/AUTHORING.md),
  [`TERMINOLOGY.md`](https://github.com/WireCatLabs/cli-docs/blob/main/docs/TERMINOLOGY.md) and
  [`REVIEWING.md`](https://github.com/WireCatLabs/cli-docs/blob/main/docs/REVIEWING.md). These stay the contract
  of the docs portal. This page links them and does not repeat them.
