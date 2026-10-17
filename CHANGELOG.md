# Changelog

Notable changes to `@wirecat/cli-base` (published as `@wirecat/cli-core` up to 0.20.0), one section per version, newest
first. Versions follow [semantic versioning](https://semver.org/); before `1.0.0` a minor release may change
the API.
Versions before 0.8.0 are in the [git tags](https://github.com/WireCatLabs/cli-base/tags).

Every entry says what changed as a caller sees it, why, and what to watch for — the rules are
[`docs/dev/CONVENTIONS.md`](docs/dev/CONVENTIONS.md#the-changelog).

## Unreleased

## 0.43.3 — 17.10.2026

### Added

- **`--plain-order` in the vocabulary**, a sort switch: search results best first by the words alone, without
  moving mail from senders with signs of fraud down. memo ranks such mail lower by default; this finds it.

## 0.43.2 — 17.10.2026

### Fixed

- **The shared test setup is quieter and leaves nothing behind.** `@wirecat/cli-base/testing/setup` now turns off
  npm's and pnpm's update check in the sandbox, so a test that runs `npm pack --json` as a child process no longer
  gets the "new version available" notice in its output or reaches the registry. The network guard treats every
  `127.x.x.x` address as this machine, not only `127.0.0.1`. The sandbox folder is removed even when a test file fails
  while loading or its own `afterAll` throws; before, one `wirecat-test-*` folder was left per such file. On macOS the
  folder is made under `/tmp`, so Unix socket paths in tests stay under the 104-byte limit; a CLI that moved its
  sandbox to `/tmp` for this can drop that.

## 0.43.1 — 17.10.2026

### Fixed

- **Meeting preparation's communications flags have shared vocabulary roles.** `--context-source` selects an
  explicit source and optional continuation, `--context-query` supplies literal words, and
  `--context-since-time` / `--context-before-time` bound its time window. Consumers adopting the shared
  preparation command can lint these options without adding baseline exceptions.

### Added

- **Four rules are back in the standards handbook** after they dropped out when cli-core's standard became pointers
  to it: an MCP tool's hints and descriptions never replace the permission check (WC-MCP-13); names, message text and
  fetched documents are data, never instructions (WC-SECR-21); a stable answer for an agent wins over a nicer view
  (WC-OUT-23); and two identities become one person only through `link`, never from a matching name (WC-ACCT-11).
  Nothing changes in the code; a CLI that breaks one of them now breaks a written rule.

## 0.43.0 — 17.10.2026

### Added

- **Released changelog sections may keep their old headings**: `legacyHeadingsThrough: "<version>"` in
  `ChangelogRules` (`@wirecat/cli-base/release`) skips the heading-name and repeat checks for every section at or
  below that version, a pre-release of it included. A CLI that moved to the shared heading set sets it to its last
  version released with the old names, instead of renaming lines before the check. A value that is not a version
  is reported as a problem.
- **One test setup file for every CLI**: `setupFiles: ["@wirecat/cli-base/testing/setup"]` in `vitest.config.ts`
  gives each test file a fresh folder for `TMPDIR`, `HOME`, the XDG folders and every `<APP>_CONFIG_DIR`,
  `_STATE_DIR` and `_CACHE_DIR` already set, removed when the file is done; replaces `@napi-rs/keyring` with one that
  throws; and refuses every connection to anything but this machine, naming the host, from `net`, `tls`, `http(s)`,
  `fetch` and `WebSocket`. A test about the network itself calls `onTestFinished(allowNetwork())`. It needs `vitest`,
  now an optional peer dependency. A CLI's own setup file, listed after it, keeps only what is the CLI's own.

### Changed — may break callers

- **`cli-dev audit` compares wa with the other CLIs** on the shared roots of the `all` parity group (`commands`,
  `doctor`, `skill`, `mcp`, `upgrade`, `search`, `notes`, `meetings`). An audit run that passes `--cli` for wa may
  find differences it did not report before; the weekly scorecard adds wa once wa is published.

## 0.42.0 — 17.10.2026

### Added

- **`mcp: false` works on a single option**: `annotateOption(option, { mcp: false })` from
  `@wirecat/cli-base/commands` marks it, and `commands --json` carries `mcp: false` on that option and nothing on the
  rest, so an MCP tool can leave it out of its input while the command stays offered. The first use is
  `messages delete --for-everyone`: agents never delete for everyone. No MCP server reads it yet.

## 0.41.0 — 17.10.2026

### Added

- **The WireCat CLI standards handbook ships in the package**, at `docs/standards/README.md`: an index, 16 area
  pages with 254 rules, from the toolchain to releases, and a checklist for a new CLI. Each rule has an id, a reason,
  the check that enforces it or "review only", an example, its exceptions and the CLIs it applies to. A rule lives
  on one page; a rule that moved or merged keeps its old id as a pointer, so a citation still resolves.
  `pnpm docs:check` checks the ids, the rule counts in the index, and that every "Enforced by" entry names a real
  check: one in this repository, or one in another WireCat repository written as `<repo>: <check>`.

## 0.40.4 — 17.10.2026

### Added

- **`scan` is a known verb**: read stored messages for what a rule finds, such as tasks, and list it; record
  it only with `--yes`. For `tasks scan <chat>` in cli-core, the name the owner chose over `tasks apply`.
- **`mcp: false` keeps a command off MCP servers**: set on a command or a whole group with `annotate`, it covers every
  command below it. `commands --json` carries `mcp: false` on each command it reaches and nothing on the rest, so MCP
  tool lists can be built from the command tree. Agents running the CLI itself are not affected.

## 0.40.3 — 17.10.2026

### Added

- Release source checks support Go through its pinned toolchain and CodeQL autobuild. Callers
  opt in with `go` in `languages` and set `go-version-file` for a nested module; interpreted
  language checks retain their existing build mode and critical severity policy.

- **Spreadsheet structure uses shared `insert` and `format` verbs.** `insert` adds bounded rows,
  columns or cells before an explicit position; `format` changes selected cell presentation
  without replacing values. Consumers can remove these dated vocabulary exceptions after adoption.

## 0.40.2 — 17.10.2026

### Fixed

- **An upgrade through pnpm installs the newest version.** pnpm 11 installs only versions at least a day old
  (`minimumReleaseAge` 1440), so `pnpm add -g <package>@latest` could install a day-old release — on 2026-10-17 an
  older `tg` than the one installed — while the update notice named the newest. `updateCommand("pnpm", …)` now adds
  `--config.minimumReleaseAgeExclude=<scope>/*` for the package's own scope; every other dependency keeps pnpm's wait.


## 0.40.1 — 17.10.2026

### Added

- **Spreadsheet commands have shared vocabulary.** `sheets` names remote spreadsheets;
  `--values <json>` supplies cell rows, `--input <mode>` selects input parsing and
  `--render <mode>` selects returned value representation. Drive uses the existing `info`,
  `show`, `update`, `add` and `clear` verbs. Consumers can remove corresponding dated lint
  exceptions after adopting this version; existing baselines need no additions.
- **`places` is a view noun**: the street addresses confirmed as places, most mentioned first, as in
  `tg <profile> mentions places` (cli-core 0.308.0). The `unknown-verb` lint no longer reports it; tg and max can
  drop that baseline line after adopting this version.

- **`--certainty <n>` is a known flag** (role `value`): how sure an agent is, 0 to 1, kept with what it wrote, as
  `tasks close --certainty` in cli-core takes it. tg and max listed it in their `option-role` lint baselines; after
  they update cli-base those lines are stale and go.

### Fixed

- **The shared changelog guard can restore a historical section to its exact immutable tag.** This repairs notes that raced publication without permitting arbitrary historical edits; missing tag content still fails closed.

- **The changelog guard refuses a pull request that repeats a `###` heading in a section not yet released**
  (`### Fixed` twice under `## Unreleased`). Each app's shape check refuses it too, but only in full validation,
  so it reached main and stopped cli-core's 0.307.0 release. A repeat already on the base does not fail the guard.
  Each app moves its guard pin to take it.

- **`bin/release` restarts itself once when the release brings a newer `bin/release`**: folding the changelog and
  raising the version both fast-forward `main`, and the shell went on reading the old script from the byte it had
  reached, so the rest of the run was a mix of old and new text. It now starts the new script over with the same
  arguments; a second change during that run stops it with `run it again`. Only the repository's own release is
  affected; the published package does not change.
- **`bin/release` restarts by its path in the repository after updating `main`**: it restarted as `$0` after
  changing to the repository root, which pointed nowhere when the script was started from another folder by a relative
  path. Only the repository's own release is affected.

## 0.40.0 — 16.10.2026

### Fixed

- **An email address reads as one term, unquoted**: `from:alice@example.com` used to fail with
  `query.unsupported-operator — boost and minimum-should-match are not supported`, because `@` is Lucene's
  minimum-should-match operator. Inside a word, `@` followed by a name with a dot (`user@host.tld`) now stays part of
  the word. `(a OR b)@2` and `word@2` still fail as before.

## 0.39.0 — 16.10.2026

### Added

- **A query that fails on an unquoted value with an operator in it says to quote it.** `url:a.com/x?y=1` used to
  fail with only `query.invalid-syntax at position 14`: `/`, `?`, `=` and `:` are query syntax. The error now ends
  with `put the value in quotes: url:"a.com/x?y=1"`, also in `details.alternative`. A failure that already carries
  an alternative keeps its own.

## 0.38.0 — 16.10.2026

### Added

- **A command says how long it runs**: `CommandMeta.lifetime` (`persistent` until stopped, `interactive` until a person
  answers; unset is bounded by the default timeout) and `cooperative` (stops at its own pace when aborted from outside),
  set with `annotate` and printed in `commands --json`. A runner reads them with `metaOf` instead of matching command
  names.

### Fixed

- **Release scripts report observed lock holders separately from stale release labels.** Shared
  diagnostics no longer attribute a live lock to a previous run; wait for the holders to finish, then
  retry.

## 0.37.0 — 16.10.2026

### Added

- **The vocabulary registers `apply`, and `inspect` covers a mailbox.** `apply` runs the owner's saved rules over
  what is already stored and changes what they match, saying only what would change unless `--yes` (memo's
  `mail rules apply`); `test` stays the read-only twin that never changes anything. `inspect` now means looking at
  a source before taking anything from it — a chat link without joining, a mailbox without importing (memo's
  `mail probe` becomes `mail inspect`). Both were `unknown-verb` findings in memo's command lint baseline.

## 0.36.0 — 16.10.2026

### Added

- **`cli-dev changelog fold --land` lands the fold through a pull request and redoes it once when main moves.**
  bin/release used to fold, open the pull request and wait on its checks; a session that merged a change to
  CHANGELOG.md meanwhile left the pull request unmergeable and the release stopped (cli-core#1335). With
  `--land` the fold is made on a fresh `origin/main`; a pull request that conflicts — found before waiting on checks,
  since a conflicting one gets none, or when the merge is refused — is closed and the fold made again on the new
  main, once. It prints the line and the pull request when it landed, nothing when there was nothing to fold (another
  session already did), and fails after a second conflict or on failed checks. It needs `gh` and a clean `main`.
- **`mergeRepeatedHeadings` (`@wirecat/cli-base/release`) and `cli-dev changelog fold` merge a `###` heading the
  dated section repeats.** A pull request branched before a fold adds under the unreleased heading; git applies the
  hunk under the dated heading beside the section's own copy, and docs:check refuses "Added twice" (cli-core 0.294.0
  after #1327). With no unreleased section on top, the fold now merges the dated section's repeats and prints
  `merged repeated headings in <version>`.

### Fixed

- **The fold no longer leaves a blank line inside a merged list.** When a section already repeated a heading, the
  blank line before its second copy ended up between the merged entries. Headings that differ only by trailing
  spaces now merge too.

## 0.35.0 — 15.10.2026

### Added

- **Bounded batches share parsing, correlation and sequential execution.** `prepareBatch`, `readBatchInput` and
  `runBatch` accept explicit registered handlers, cap input/count/read reservations and retained output, and keep
  a result for every input on budget refusal. Failed reads never refund their reserved ceiling; it is not a byte
  consumption measurement. Hosts retain account authorization, cancellation, final rendering and resource cleanup.
  `projectBatchAnswers` selects nested answer fields while retaining ids, errors and completeness.

## 0.34.0 — 15.10.2026

### Added

- **`cli-dev changelog fold` folds `## Unreleased` into the dated section below it.** One session dates the version
  and sets package.json; before anyone publishes, another merges a new `## Unreleased` above it, and the release
  refuses until someone folds by hand (cli-core#1300 fixed it for cli-core alone). The command rewrites CHANGELOG.md
  when the section below the unreleased one is `## <version> — ` (`--version`, package.json's by default): same-named
  `###` headings merge, the unreleased entries first, the date stays. It prints `folded Unreleased into <version>`
  when it folded and nothing otherwise, and fails on text under the unreleased section before its first `###`
  rather than lose it. `--unreleased «Не выпущено»` names another title. It does not ask npm: run it in
  bin/release only while the version is not published, or it adds entries to released notes. `foldUnreleased` is
  exported from `@wirecat/cli-base/release` for the same job in code.

## 0.33.0 — 15.10.2026

### Changed — may break callers

- **The shared vocabulary registers the words of cli-core's task, mention and picture commands.** Verbs `claim`,
  `release`, `merge`, `unmerge`, `defer` and `embed`; views `agenda`, `categories` and `domains`; resources `images`
  and `duplicates`; flags `--into <id>`, `--all-in-chat`, `--due-within <duration>`, `--unanswered <duration>`,
  `--waiting <duration>`, `--category <name>`, `--holder <name>` and `--lease <duration>`. `tasks plan` stays
  unregistered: `plan` is a synonym of `update`. A filter is still not registered, so `tasks agenda --tag`,
  `--claimed` and `tasks duplicates --unsure` keep their `option-role` finding. A CLI that moves to this version
  must remove the baseline entries these clear, because a stale entry fails: on tg, for example, `unknown-verb`
  `tasks claim`, `option-role` `tasks agenda --holder` and `unknown-resource` `images`.

## 0.32.0 — 15.10.2026

### Added

- **The shared vocabulary registers 13 more flags that apps carried without a role.** Rule fields `--sender`,
  `--domain`, `--list-id` and `--do <actions>` (what a rule does, the same list tg and max's reply rules take);
  `--clear`, `--ignore`, `--subfolder`, `--occurred-time`, `--grant <scopes>`, `--min-similarity`, `--domain-age`,
  `--retry-attachments` and `--all-versions`. `--occurred` is now a synonym of `--occurred-time`, and
  `--target-accounts` of `--source`. A CLI that moves to this version must drop the `option-role` baseline entries
  these clear, because a stale entry fails, and rename the flags `flag-synonym` now names.

### Fixed

- **Changelog checks reject duplicate release and pending headings.** Repeated versions could hide
  changed notes behind an unchanged copy. Keep one section per version and one pending section.

## 0.31.1 — 15.10.2026

### Fixed

- **Nested field selection traverses arrays and retains report coverage.** Item/list envelopes, continuation, missing data and operation identifiers are handled by one shared projector; consumers no longer need to unwrap item answers.

## 0.31.0 — 15.10.2026

### Changed — may break callers

- **The shared vocabulary registers 158 more flags with a role, and names 20 more flags as synonyms.** These are the
  options tg, max, memo, drive and zm already use, such as `--chat`, `--model`, `--title`, `--sync-time` and
  `--max-bytes`. A filter is still not registered: it belongs in the list's query. On 2026-10-14 this clears 226 of
  tg's 287 `option-role` baseline entries, 216 of max's 281, 114 of memo's 146, 39 of drive's 53 and 74 of zm's 88.
  A CLI that moves to this version must remove those entries from its baseline, because a stale entry fails. It
  also gets new findings to fix:
  - `flag-synonym`: for example `--refresh` is `--sync-first`, `--budget` is `--max-pages`, `--estimate` is
    `--dry-run`, `--offset` is `--cursor` and `--destination` is `--output-dir`.
  - `flag-two-meanings`: a use whose value name differs from the registered one, such as zm's
    `--title <text>`, which is `--title <title>` in the vocabulary.
- **A flag's value name may contain `=` or `:`, and may end in `...`.** So `<key=level>`, `<hh:mm>` and `<ref...>`,
  which commands already show, can be registered.

- **`node-ci.yml` no longer leaves the job token in the checkout.** Its `check`, `bun` and `secrets` jobs check out
  with `persist-credentials: false`, so nothing a dependency runs in those jobs can read the token from `.git/config`.
  A caller whose `checks` lines push or call `git` against the remote with that token needs its own job for it.
- **`release-checks.yml` asks for less.** Only the `source` job requests `actions: read` and
  `security-events: write`; the dependency audit reads the lockfile without `pnpm install`, so no
  lifecycle script runs; the secret scan no longer keeps the checkout token. Callers granting
  `contents: read`, `actions: read` and `security-events: write` need no change.

### Fixed

- **The shared `release-checks.yml` gate now blocks critical CodeQL findings.** CodeQL 2.27 lists its
  rules under `tool.extensions`, not `tool.driver`, so every finding scored 0 and the gate always
  passed. Rules are now resolved through each result's `rule.toolComponent`, and a finding whose rule
  is not in the report fails the gate instead of passing it. Callers get this when they bump their pin.

## 0.30.0 — 14.10.2026

### Fixed

- **`cli-dev audit` no longer reports a command as missing from a whole-tree pair when neither member has it.** A
  path only another CLI has (memo's `catalog`, `mail`, `meetings projects`) came out as `max+tg catalog: presence:
  only in ` with nobody named, 21 false findings on 2026-10-14. A path counts as missing only when at least one
  member of the group has it.

### Added

- The shared command vocabulary defines `prepare` as bounded cited context assembly and classifies
  `--meetings`, `--cues` and `--context-limit` as work budgets, `--history-since-time` as a target
  history window and `--meeting-preparation` as opt-in tool exposure. Preparation commands reuse
  `--since-time` and `--before-time` for an inclusive start and exclusive end. Command lint can
  check these workflows without new baseline entries or per-tool overrides.

## 0.29.0 — 14.10.2026

### Changed — may break callers

- **`updateNotice` names `upgrade`, and stays silent only when the upgrade is the command being run.** The line said
  `` `<cli> update` installs it `` while every CLI's command is `upgrade`, the standard's required root, and it went
  silent whenever the word `update` appeared anywhere, so `tasks update` never saw a notice. The word is now
  `upgradeCommand`, default `"upgrade"`, and the notice skips only when it or `complete` is one of the first two words
  that are not options (a profile may come first). A CLI that patched the line with `.replace(...)` or skipped on
  `argv.includes("upgrade")` itself can drop both.
- **`skill show` and `skill install` carry their effects.** `show` reads this machine, `install` writes to it, and
  neither touches the service; before, they had none and counted as writes. A host that annotated them itself can stop.

### Removed

- **`legacyMacPaths` and `migrateLegacyMacPaths` are gone, with the `LegacyMove` and `MigrateLegacyPathsOptions`
  types.** Every machine that ran a release with `~/Library` folders has moved them. A CLI that calls the migration at
  start drops the call.
- **`noopLogger` and `isTransportFailure` are gone.** Nothing used them.

## 0.28.2 — 14.10.2026

### Added

- **`readJsonResponse` reads UTF-8 JSON within an explicit byte budget.** HTTP adapters can reject
  oversized or malformed bodies before parsing, even without a trustworthy Content-Length. The
  `/http` helper supports cancellation and releases its reader; callers still own status handling
  and provider validation. It adds no HTTP dependency to the root export.

## 0.28.1 — 14.10.2026

### Changed — may break callers

- **`--operation-id` replaces `--send-id`, and `operation_id` replaces `send_id`.** One id per meaning: the flag
  that repeats a write after an unknown outcome names the same attempt as the answer's `operation_id`. The flag row
  lists `--send-id` in `replaces`, so `flag-synonym` reports a CLI that still takes it, and `identifier-name` reports
  a `send_id` key. `projectFields` keeps only `operation_id` beside the projected fields.

### Added

- **Vocabulary rows for `--all`, `--as-owner` and `--problems`.** `--all` (paging): every item at once, instead of one
  page or one target. `--as-owner` (mode): record an action as the owner's when an agent's terminal runs the tool.
  `--problems` (output): only failures, warnings and crashes (`runs show`). cli-core already ships all three, so apps'
  `cli-dev lint` stopped reporting them as unknown flags.

## 0.28.0 — 14.10.2026

### Changed — may break callers

- **`effects` replaces `mutates` and `local` on commands.** `annotate(command, { effects: { remote, local } })`, each
  `none | read | write`; `commands --json` prints `effects`. `mutates: true` is `remote: "write"`, `mutates + local` is
  `local: "write"`. A command without `effects` counts as a write, so annotate every read command, or its failures are
  never safe to retry and steps to it are never safe to run unasked. MCP's `readOnlyHint` is `!writes(effects)`.
- **The error object carries `retry: { safe, after_ms? }`, always.** `errorObjectOf` derives it from the code, the
  failed command's `effects` (new `FailureContext.effects`) and the new `sent` detail: a transient failure (`timeout`,
  `rate_limited`, `network_error`, `provider_unavailable`, `provider_error` with `retryable: true`) of a command that
  writes nothing, or of a write with `sent: false`, is safe; `outcome_unknown` never is. `retryable` and
  `retry_after_ms` are read into `retry` and no longer copied into `details`. `operation_id`, one write attempt, is a
  common detail now, so an unknown outcome names the attempt to look up before trying again.
- **A next step has `kind` and `safe_to_auto_execute`.** `kind: "command"` keeps `command` and `args`;
  `kind: "user_action"` (defined with `{ id, kind: "user_action", why }`) has neither and is never safe. A command
  step is safe only when its target is known to write nothing. At most two steps per answer (`MAX_NEXT_STEPS`, was
  three): the one to take, then one alternative.
- **`stepOf` checks that a step binds.** Argument values must be scalars, or lists of them, on one line — a paragraph
  read out of a message never becomes a step. With `targets` (`stepTargets(program)` from `/commands`, or
  `FailureContext.targets`), the command must exist and take every argument named, the `*` step included; a
  command takes its own options, its groups' and the root's, each named by its long flag (`--no-input` is
  `no_input`).
- **`meta.complete` and `meta.issues` replace `meta.skipped`.** `complete` is required on every envelope: `false` when
  a source failed or was skipped, with `issues: [{ code, reason?, source }]` (`code` is an error code, so a skipped
  account is `authentication_error`, not free text). `truncated` (a size cap cut the answer) and `page.has_more`
  (another page exists) keep their own meanings. A command that may answer partially declares
  `annotate(command, { partial: true })`, shown in `commands --json`; `exitCodeOfAnswer(meta, partial)` exits 0
  only then, else with the first issue's code.
- **`page` says how the source pages.** `{ mode: "page", limit, has_more, next_page? }` or
  `{ mode: "cursor", limit, has_more, next_cursor? }`; `cursor` is gone. A cursor source never shows page numbers.
- **An override names its owner and a review date.** Each `lint/overrides.json` entry needs `owner` (a GitHub handle
  or team, `@leemour`) and `review_after` (`YYYY-MM-DD`); `cli-dev lint` and `cli-dev audit` fail one past its date.
  `overridesProblems(entries, today)` takes the date. `cli-dev audit` names a rule overridden more than three times
  across the CLIs it reads (`rulesForReview`, `OVERRIDE_RULE_REVIEW`), without failing; the per-repo budget of 10
  stays.
- **`api_operation` replaces `operation_id` on commands.** `annotate(generated, { api_operation })` and the commands
  document key: the catalog operation a generated command was made from. `operation_id` now means one write attempt
  only, as `IDENTIFIERS` says.
- **A log record's `body` is its event id, never a sentence.** `createRecordLog` and `logRecordOf` write the
  `event` attribute as `body` and drop the message passed beside it (`log.error({ event }, "text")`), which could
  quote content. `errorRecordOf` names its record `command.failed` and moves the message into `attributes.message`.
  Give every record a registered dotted `event`, or its `body` is empty.

### Added

- **`Streams.drain(signal?)`.** A caller that wrote a lot of output can wait until stdout and stderr have flushed, or
  give up when the signal aborts. Optional on `Streams`; `processStreams` implements it.


- **JSON lines with an end line:** `jsonlOf(envelope)` prints `{"type":"item","data":…}` per item, then
  `{"type":"end","complete":…,"issues"?:…,"page":…}`, so a reader tells a finished stream from a cut one;
  `jsonlItemSchema` and `jsonlEndSchema` describe them, and `key-casing` checks both.
- **`missing` entries may have no `step`**, for a field nothing can fill.
- **The `absent-null` field rule and the `nullable-list` lint rule** (medium): absent is not asked or not known,
  `null` is known to have no value, `[]` is known empty, `0` is measured. The lint fails a list in a registered
  JSON Schema that may be `null`. Run `cli-dev lint --write-baseline` once to record today's.
- **Flag synonyms.** A vocabulary flag lists its other names in `replaces` (`--limit`: `--max`, `--count`, `--take`,
  `--max-results`); the `flag-synonym` lint rule (medium) reports them, and `option-role` leaves them to it.
- **The identifiers glossary**, `IDENTIFIERS` and `defineIdentifiers`: `run_id` (one invocation), `operation_id` (one
  write attempt), `request_id` (the provider's reference), `trace_id` (tracing). The `identifier-name` lint rule
  (high) reports `execution_id`, `invocation_id`, `log_id` and `diagnostic_id` in a registered schema or the commands
  document.
- **Registered log events.** `defineLogEvents([{ id, meaning, keys }])` — a dotted id such as
  `provider.request.failed` and the attribute keys each record carries; `LOG_EVENTS` holds cli-base's own
  (`command.failed`). `logEventProblems(record, events)` names an unknown event or a missing key, and
  `expectRegisteredEvents(lines, events)` from `/testing` throws on either, so a test fails on an event nobody
  registered.

### Fixed

- **A config file that exists but cannot be read is an error, not an empty config.** Only a missing file falls back
  to defaults; a directory, a file used as a parent folder, or an I/O failure reports the filesystem error, so a bad
  path no longer silently resets every setting.

## 0.27.2 — 14.10.2026

### Added

- **`--scan-limit <n>` is a shared read-budget option.** Commands can bound candidate inspection separately from returned matches and byte reads. Adopting consumers remove any now-stale lint baseline entries for this option.

## 0.27.1 — 14.10.2026

### Added

- **`cli-dev audit`**: two or more CLIs, from their `commands --json`, against every lint rule and against each other
  — required roots, the same contract on a shared path, the same meaning for a flag, one schema per output entity, one
  name per failure. It prints a scorecard (a table, or the list envelope with `--json`) and fails on a finding the
  baseline in `audit/baseline/` does not hold. `/standards` adds `AUDIT_RULES`, `PARITY_GROUPS`, `REQUIRED_ROOTS` and
  `AUDIT_BLOCKS`, the switch that makes a new cross-CLI divergence fail a release (`"new"`, today) or only show
  (`"never"`). A weekly workflow audits the five latest published CLIs and rewrites one pinned issue.

### Fixed

- The shared `--bytes` budget uses `<bytes>`, matching existing evidence commands and preventing a false two-meanings lint failure.

## 0.27.0 — 14.10.2026

### Changed — may break callers

- **A log record carries only allow-listed attribute keys.** `createRecordLog` writes a top-level attribute key that is
  not in `LOG_ATTRIBUTE_KEYS` or the new `allow` option as `"[not allowed]"`, and redacts any key that names content
  (`isContentKey`: `text`, `chatTitle`, `errorMessage`, `accessToken`, `phoneNumber`, …) at any depth. Pass every key
  your writers log in `allow`, or `runs show` loses those fields. A writer that builds its own lines calls
  `logRecordOf`, the same builder.

### Added

- **`log-attribute-key` lint rule** (high): no key of the CLI's log allow-list names message text, a token or a phone
  number. Pass `logAttributesJsonSchema(allow)` as `log_attributes` in `cli-dev lint --schemas`; without it the rule
  checks cli-base's own list. `key-casing` skips that entry, as log attribute keys are camelCase for now.
- **`traceIdOf(traceparent)`** in `/standards`: the trace id of a W3C `traceparent`, or undefined for one the spec
  says to ignore — for an MCP caller's `_meta.traceparent` or a `TRACEPARENT` variable.

## 0.26.1 — 14.10.2026

### Added

- **The shared vocabulary names an offline source catalog.** `catalog` is a stored file/folder metadata resource, `tree` its hierarchy view, and `--depth <n>` a traversal budget. Consumers can expose offline browsing without provider-specific naming exceptions; list filters still use the shared query language.

- The `passage` view names a cited transcript anchor with bounded surrounding lines. Evidence budgets `--bytes` / `--max-read-bytes` and `--expected-fingerprint` are registered; the existing `--before-n` / `--after-n` counts also describe transcript lines.

- **The verb `rebuild`**: compute again, from what the store already holds, what the tool derives from it, keeping
  the owner's decisions. cli-messaging's `mentions rebuild` (phones, e-mail and links found in stored text) is
  the first command to use it.
- **The resource `mentions`**: phones, e-mail addresses, links and documents found in stored text, each where it was
  written.

### Changed — may break callers

- **`identities` now means every way to reach a person or an organization** — an account in a messenger or mailbox,
  an e-mail address, a phone — not only messenger and mailbox accounts. Only the description changes; no rule does.

## 0.26.0 — 13.10.2026

### Changed — may break callers

- **116 more vocabulary flags with a role**, from the flags tg, max, memo, drive, zoom and cli-messaging share:
  output (`--json`, `--jsonl`, `--fields`, `--brief`, `--full`, `--quiet`, …), sort (`--measure`, `--score`,
  `--newest`, `--order`, `--weights`), mode, action, budget (`--max-*` with their units), target and value rows.
  `option-role` drops in every app: memo 244 → 141, drive 66 → 56, max 562 → 317, tg 576 → 329, zoom 157 → 106,
  cli-messaging's chat app 366 → 151; no other rule rises. Filter flags get no row: they become query fields.
  `cli-dev lint` fails on the now-stale `option-role` baseline entries until the app runs `--write-baseline` at its
  bump; regenerate cli-messaging's STANDARD flag table too.
- **The parsed query tree is snake_case.** A range predicate carries `lower_inclusive` and `upper_inclusive`, and a
  negated clause has `occur: "must_not"`; `DateRange` from `dateRange` has `lower_inclusive` and `upper_inclusive`.
  The tree is JSON an agent sends back (an MCP `ast`, a saved search), so it follows the one casing for every key.
  A tree stored in the old form fails the new `queryAstSchema`: rewrite stored trees before reading them.

### Added

- **`queryAstSchema` and `queryNodeSchema`** in `/query`: the tree's valibot schema, so a caller validates an `ast`
  it receives instead of keeping its own. `key-casing` checks it as the base schema `query_ast`.

## 0.25.0 — 13.10.2026

### Changed — may break callers

- **Every JSON key the standard defines is snake_case.** The envelope: `page.has_more`, `meta.run_id`,
  `meta.duration_ms`. The error object: `error.run_id`; error details `retry_after_ms`, `request_id`,
  `timeout_ms`, `max_bytes`, `buffered_bytes`, `partial_output`. The log record: `run_id`, and `trace_id` as
  OpenTelemetry spells it for JSON log lines; `thrown_message` in an error record's attributes.
  `commands --json`: `global_options`, `inherited_options`, `exit_codes`, `takes_value`, `operation_id`, and
  `implies` keyed by long flag (`--refresh`) instead of Commander's attribute name. One casing for every key, so
  an agent never guesses. Reasons' `details`, step argument names and `{placeholders}` must now be snake_case,
  or `defineReasons` and `defineSteps` throw at start-up; `annotate` takes `operation_id`; `projectFields` keeps
  `operation_id` and `send_id`. Bump your `contract`.
- **The field rule `camel-case` is now `snake-case`**, and a duration key ends in `_ms`.
- **Every vocabulary flag has a `role`**, one of `FLAG_ROLES`, and `defineVocabulary` refuses a flag without one.
  There is no filter role: a filter is a query field.
- **Query error messages start with the command that ran**, `chats list: query.unknown-field at position 8`, in
  place of `search:`; the guide link is in `details.guide` only when the caller passes one. The `~` hints no
  longer name `--language legacy`, a messages-search option.

### Added

- **`--account`, `--provider` and `--source` in the vocabulary** with role `scope`: they choose the accounts a
  command reads, so `filter-flag` and `option-role` no longer report them.
- **One query language for every list: `@wirecat/cli-base/query`.** The Lucene 9.12.3 parser port moves here
  from cli-messaging with its date handling. `queryFieldsOf` derives a list's fields from its entity schema,
  `validateQuery` checks a query against them, `fieldsHelp` prints the Fields section, `defineQuery` refuses a
  field whose example does not run, and `QUERY_REASONS` registers the shared `query.*` errors, with
  `query.bare-word`, `query.invalid-number` and `query.unsupported-placement` new. `evaluate` judges one item
  against a query, for tests: a list filters in its store or at the provider, never in memory.
- **`annotate` takes `output: { entity, view? }` and `query`, and `commands --json` carries both**, so an agent
  sees what a list answers with and which fields it filters by.
- **`reference` joins `isoTime` in `/standards`**: the schema of a typed name such as `note:42`.
- **Four lint rules for lists.** `filter-flag` (an option of a read-only command named after a field of its
  entity, scope flags exempt), `option-role` (an option with no role in the vocabulary), `list-without-query` and
  `query-example`. Today's violations go to your baseline with `--write-baseline`.
- **`cli-dev lint` checks key casing.** The new rule `key-casing` fails on a key that is not snake_case in
  cli-base's schemas, the commands document as the CLI printed it, and the schemas given with
  `--schemas <file>`. A CLI with camelCase keys left baselines them with `--write-baseline`.

### Security

- **Log redaction also hides `refresh_token` and `verify_code`**, so snake_case events are covered.

## 0.24.0 — 13.10.2026

### Changed — may break callers

- **`commands --json` names exit code 1 `internal_error`**, the code a crash reports, in place of
  `generic_failure`. A reader that looked the key up by its old name reads `internal_error`.

### Added

- **`--debug` in the vocabulary:** on failure, show the full error record, cause and stack.

## 0.23.0 — 13.10.2026

### Added

- **`createRecordLog` writes the standard log record.** Each call appends one `LogRecord` as a flat JSON line —
  `time`, `severity`, `body`, `runId`, `traceId`, `command`, `attributes`, `resource` — to a file (mode 0600) or
  hands it to a function, so a log written to stderr gets the same record. The event becomes `attributes`;
  `body` is the message when given, else the event's `event` name. Lines are appended synchronously, so an exit
  never drops the tail.
- **One failure handler: `errorObjectOf`, `renderError`, `errorRecordOf`, `mcpErrorResult`, `catchCrashes`.**
  Any thrown value becomes the one error object `{ error: { code, reason, message, param?, details?, next?,
  runId? } }`. The reason comes from `details.reason` when the package registered it, else from the code's
  base reason (`BASE_REASONS`, one per code). Only the reason's detail keys and `COMMON_DETAILS` survive;
  `cause` never does. The next step is chosen by the reason's `step`, never by the message text. A person sees
  `✗ message`, one `→ next step` line and `details: <cli> runs show <runId>`; `--debug` callers pass the
  record from `errorRecordOf` instead, the only place a cause or stack is shown. The CLI's machine output and
  MCP's `structuredContent` are the same value. `catchCrashes` reports a throw before a CLI's own handler.
- **`CRASH_CODE` (`internal_error`) and `CRASH_REASON` (`command.crashed`)** for a failure that is not a
  `CliError`: exit 1, a fixed message — the thrown text never reaches the user. It stays outside `errorCodes`,
  so no command can raise it.
- `CliErrorDetails` names `reason` and `param`.
- `FailureContext.details`: detail keys a package allows on every reason until each is registered on its own.
- **Two `cli-dev lint` rules for help examples**, ported from the Azure CLI linter. `command-example-count`: every
  handwritten leaf has one to three `examples`. `faulty-help-example-parameters`: each example starts with the
  tool, may name a profile, runs the exact command path, gives the arguments that command takes and only its own,
  its parents' and the global options. The check reads `commands --json`, so it needs no live Commander tree.
  Generated commands are exempt: their examples would restate the API they mirror.
- **Vocabulary for drive, memo and zm.** Verb `run`; resources `files`, `comments`, `meetings`, `recordings`,
  `jobs`, `actions`, `aliases` and the singulars `vocabulary` and `api`; views `transcript` and `evidence`; flag
  `--until-time <time>`.

### Changed — may break callers

- **`errorObjectSchema.runId` is optional** until every CLI keeps a run for each failure.
- **Reasons cli-base raises are dotted and registered:** `command_timeout` → `command.timed-out`,
  `output_limit` → `output.too-large`, `projection_unavailable` → `output.fields-unavailable`. A script that
  matched the old strings has to switch.
- The handler also recognises a `CliError` from a cli-base copy older than 0.22.0 by name and code, since
  those carry no brand.
- **`unknown-verb` accepts `search <resource>`.** A leaf under `search` (`search messages`, `bot search messages`)
  passes when its name is a resource noun or `all`, as STANDARD's search hierarchy places it. A CLI that adopts
  this must delete the now-stale baseline entries and overrides, and runs the two example rules for the first
  time: `--write-baseline` records the examples it still lacks.
- **Redaction applies at every depth, arrays included.** It used to stop two levels down.

### Removed

- **`createFileLogger`, `FileLogger` and `FileLoggerOptions`, and the `pino` dependency.** Use `createRecordLog`
  with a `runId`, `command` and `resource`; there is no `close()` to await any more.

## 0.22.0 — 13.10.2026

### Added

- **`/standards`: the registries one standard for every CLI is built from.** `VOCABULARY` (verbs, resource nouns,
  view nouns, root words, flags with one meaning each), the answer envelope (`listEnvelopeSchema`,
  `itemEnvelopeSchema`, `pageSchema`, `metaSchema`, `nextStepSchema`, `missingSchema`, `FIELD_RULES`), the error
  object and reasons (`errorObjectSchema`, `defineReasons`), next steps (`STEPS`, `defineSteps`, `stepOf`), the
  log record (`logRecordSchema`) and the lint rules (`LINT_RULES`). Each is a Valibot schema; `jsonSchemaOf`
  emits JSON Schema 2020-12. A malformed entry throws a `RegistryError` naming every problem. Nothing uses them
  yet: the output, error and log streams adopt them in later releases.
- **`commandsDocument` in `/commands`: one `commands --json` shape for every CLI**, with
  `commandsDocumentSchema`, `commandsDocumentJsonSchema()` and `parseCommandsDocument`. memo, drive and zoom
  print their own shapes today; `cli-dev lint` refuses them until they switch.
- **`cli-dev lint`** judges a CLI's command tree by the lint rules — verbs from the vocabulary, resources,
  one meaning per flag, summaries present and at most 80 characters, every argument and option described —
  against a shrink-only baseline in `lint/baseline/<rule-id>.json` and counted overrides in
  `lint/overrides.json`.

- **`refuseJoinedPath` in `/commands` refuses a command path given as one argument.** `tool "projects add" --help` —
  what a zsh loop over `$c` passes — made Commander print the root help, and an agent read it as a missing
  command. Called on the words before `parseAsync`, it throws a `validation_error` naming the words to type. A
  CLI adopts it at its next bump; memo has the same check of its own until then.

### Fixed

- **`isCliError` recognises an error made by another copy of the package.** It checked `instanceof`, which is
  false when a CLI and one of its dependencies each load their own cli-base during a pin bump. It
  now checks a brand set by the constructor; `deadline` and `createOutputBuffer` use it too. Both copies must be
  this release or later: an error made by 0.21.0 carries no brand. Use `isCliError(error)` instead of
  `error instanceof CliError`.

## 0.21.0 — 11.10.2026

### Changed — may break callers

- **The package is now `@wirecat/cli-base`, and the repository `WireCatLabs/cli-base`.** The code is the same as
  0.20.0. Change every `@wirecat/cli-core` import, `extends` (`biome.json`, `tsconfig*.json`), lefthook,
  cspell, rumdl and vale path, and every `uses: WireCatLabs/cli-core/.github/workflows/…` to `cli-base`. The
  name `@wirecat/cli-core` is not deprecated: the messenger layer, now `@wirecat/cli-messaging`, takes it over
  in a later release, with versions above 0.24x, so a pin such as `>=0.20.0 <0.21.0` never crosses over. The
  code generator's default imports are now `@wirecat/cli-base/codegen` and `/codegen/runtime`; pass
  `coreImport` and `runtimeImport` to keep the old ones.

## 0.20.0 — 11.10.2026

### Changed — may break callers

- **`resolvePaths` gives the XDG layout on macOS too** — `~/.config/<app>`, `~/.local/share/<app>` and
  `~/.cache/<app>`, or the `XDG_*` variables when set — instead of `~/Library/Preferences`,
  `~/Library/Application Support` and `~/Library/Caches`. One layout on every Unix is one set of
  documentation and one place to look. Linux and Windows paths do not change, and the `*_DIR` overrides
  still win. It now reads `HOME`, the `XDG_*` variables, `USERPROFILE`, `APPDATA` and `LOCALAPPDATA`
  from the `env` it is given, not from the global `process.env`, and takes an optional `platform`.
  **On macOS, a CLI that adopts this release finds none of its existing files** until it calls
  `migrateLegacyMacPaths` at start. A keyring service name built from the config path changes with it.

### Added

- **`migrateLegacyMacPaths` moves an older release's `~/Library` folders to the new ones**, once.
  On macOS, with no `*_DIR` override set, it moves each old folder whose new one is missing or empty,
  all of them or none, and returns what moved. It never merges into a folder that has files, and
  across file systems it copies, checks the copy and keeps the old folder. It throws a
  `configuration_error` naming the processes when lsof shows a file open in a pending folder — stop a
  running `serve` or MCP server and run again. lsof sees only files open at that moment, so a caller
  that knows its own lock files should report their holders through `holders`. Call it at program start, before anything resolves a
  path; with nothing to move it costs one `lstat` per folder. `legacyMacPaths` gives the old folders.

### Removed

- **The `env-paths` dependency.** The paths it gave on Windows are kept as they were.

## 0.19.4 — 11.10.2026

### Fixed

- Package references, documentation and fixtures use the WireCat namespace throughout.


- The owner-migration helper covers meetings, testing, Zoom and the shared organization repositories, so their links and package names migrate with the original CLIs.

## 0.19.3 — 10.10.2026

### Fixed

- **Zero command deadlines abort synchronously** before a body can execute, matching the documented
  immediate deadline instead of scheduling a timer that could lose to a fast command. They create
  no sleep or timer; an already aborted parent retains its cancellation reason.

## 0.19.2 — 10.10.2026

### Added

- **Portable command control helpers** expose `fieldsOf`, `projectFields`, `createOutputBuffer`
  and `createDeadline` from the root export. Field projection retains list and operation metadata;
  a bounded UTF-8 buffer delays data until hosts finish cleanup. Deadlines use injected sleep and
  cancellation, waiting for the body to settle before callers close resources. Callers must propagate
  the signal, dispose the deadline and discard buffered output on failure; no provider/store lifecycle
  or automatic retries are imported.

### Fixed

- Windows maintenance commands support portable relative PATH entries and custom or sanitized command-processor environments while preserving separate arguments.

### Security

- Release checks include source and secret analysis; critical production advisories and critical source findings block publication. Workflow findings are reported for review. PR security remains the fast secret scan.

## 0.19.0 — 10.10.2026

### Fixed

- Windows updater and MCP setup commands resolve through absolute PATH entries and use an explicit command processor, avoiding accidental execution from the current folder. POSIX resolution is unchanged.

### Added

- `/update` exports `executableOnPath` and `executableEnvironment` for consumers using the same Windows command resolution.

## 0.18.2 — 10.10.2026

### Changed — may break callers

- **The project is now licensed under Apache License 2.0.** See `LICENSE` for the terms.

## 0.18.1 — 10.10.2026

### Fixed

- **The shared spelling list knows `wirecat`.** `cspell` no longer flags the new package scope in READMEs.

## 0.18.0 — 10.10.2026

### Changed — may break callers

- **The package is now `@wirecat/cli-core`, and the repository is `WireCatLabs/cli-core`.** Install
  `@wirecat/cli-core` and change imports from `@wirecat/cli-core` (and its subpaths) to `@wirecat/cli-core`;
  the code is the same as 0.17.3. `@wirecat/cli-core` gets no new versions. Call the reusable workflows
  as `WireCatLabs/cli-core/.github/workflows/...`.

## 0.17.3 — 09.10.2026

### Changed — may break callers

- **Production dependency and workflow security checks run before releases.** Call the reusable
  `release-checks.yml` workflow from each release workflow and require it before building. `node-ci.yml`
  keeps lint, typecheck, coverage, build, Bun and secret scanning on changes.

### Fixed

- **Display sanitization makes Unicode tags and byte-order marks visible.** Subdivision flag emoji
  stay intact. CLI machine output continues to preserve original strings.

## 0.17.2 — 07.10.2026

### Added

- **`indent(text, spaces)` shifts every line of a block right.** A step's body under its heading, or a
  QR code, can sit indented in a setup screen. Empty lines stay empty, so no trailing spaces are printed.

## 0.17.1 — 04.10.2026

### Fixed

- **`cli-dev docs-check` and `markdownFiles` skip what is not a file or a folder.** A device or a
  pipe named `*.md` used to be read, and the check crashed. Claude Code's Bash sandbox lays devices
  over names in the working folder (`.claude/loop.md`, `.claude/skills`), so the check failed in
  every agent session with the sandbox on. A symbolic link to a file is still listed; a link to a
  folder is still not followed.

## 0.17.0 — 03.10.2026

### Changed — may break callers

- Consumers switching exhaustively over `SchemaNode` or API parameter locations must handle explicit unions and RPC body parameters. Existing HTTP models generate the same artifacts.

### Added

- API generators preserve explicit unions and Boolean literals, validate nested references, and emit schema definitions for shared command input traversal. RPC parameters can belong to the JSON body; multipart references retain their format. Source adapters can mark secret fields so consumers keep them out of generated CLI arguments.

## 0.16.0 — 02.10.2026

### Added

- **`@wirecat/cli-core/mcp` installs and checks local stdio MCP entries.** A CLI can add its existing
  MCP server to Codex or Claude Code through those clients' own commands and probe the handshake and
  tool list without calling a tool. Existing entries are refused, so callers must remove one in the
  client before changing it.
  Client commands use `cross-spawn` so npm's Windows `.cmd` shims can be started.

## 0.15.0 — 01.10.2026

### Added

- **`annotate(command, { mutates: true, local: true })`** marks a write that changes only this
  machine — a file, the keyring — and never the service. `CommandInfo.local` carries it, and
  `mutates` stays true, so a caller that tells reads from writes still sees a write.
- **`commandsPage` text takes `mutatesLocal`**, the line shown under such a command instead of
  `mutates`. Without it a local write gets no line. Before this, tg-cli labelled `config set` as
  changing Telegram.

## 0.14.0 — 01.10.2026

### Added

- **Shared settings for checking docs**: `@wirecat/cli-core/cspell` (spelling in English, British
  English and Russian, with the shared word list; code and links are not checked),
  `config/rumdl.toml` (Markdown form) and `config/vale/` (prose: filler words and long sentences in
  both languages, and tg's tone). A repository installs the tools itself — [README](docs/TOOLING.md).
- **`cli-dev docs-check --pages`** also checks `docs/` against `docs/meta.json`, the docs portal's
  page structure.

## 0.13.0 — 01.10.2026

### Added

- **`skillCommand(app, skill, environment, more)`**: `more` names skills a library ships for every CLI
  built on it, and `skill show <name>` prints one, with `{{command}}` turned into the CLI's command.
  cli-messaging ships one for linking conversations. They are printed, never installed — two CLIs
  would install the same name. Without `more`, `skill show` takes no argument, as before.
- **The shared pre-push hook runs `parity:check` after `typecheck`**, when the project has that
  script. tg-cli and max-cli check their commands and pages against cli-messaging's parity manifest
  before a push instead of a minute later in CI. A project without the script sees no change. Why in
  one command: the check builds into the same `dist/` that typecheck writes, and two `tsc` runs side
  by side race on its state file.

## 0.12.0 — 01.10.2026

### Changed — may break callers

- **`commandsPage` writes what tg-cli's own copy of it already did**: each description ends as a
  sentence, the allowed values follow it ("One of: `new`, `old`."), an argument shows its default
  as an option does, and a `~` is escaped — `~~struck~~` in a description struck out the rest of
  the row. `CommandsPageLabels` gains `oneOf` (`COMMANDS_PAGE_LABELS` has it in both languages).
  What to watch for: a regenerated `commands.md` changes on almost every row; a caller with its
  own labels adds `oneOf`.

## 0.11.0 — 01.10.2026

### Added

- **Shared configuration a CLI extends instead of copying.** `@wirecat/cli-core/tsconfig.base.json`
  (compiler options), `/tsconfig.test.json` and `/tsconfig.scripts.json` (the no-emit overlays for
  tests and `scripts/`), `/biome` (formatter, linter, the `scripts/` console rule) and
  `config/lefthook.yml` (the git hooks). Paths, file lists and import rules stay in each repository.
  What to watch for: in lefthook, the extended file overrides your own `lefthook.yml`, not the other
  way round. How to adopt each: [README](docs/TOOLING.md).
- **`cli-dev`, a command for the development scripts every CLI carried a copy of:** `slow-tests`,
  `next-version`, `version`, `docs-check` and `test-matrix`. Each prints what the script it replaces
  printed; the test matrix page names `cli-dev` in its first line, so a repository regenerates and
  commits that page once when it switches.
- **`.github/workflows/node-ci.yml`, a reusable workflow:** install, lint, typecheck, test with
  coverage, build, the extra checks a repository passes in, the Bun run and a gitleaks scan of the
  whole history.

## 0.10.0 — 01.10.2026

### Added

- **`@wirecat/cli-core/skill` installs a CLI's SKILL.md and tells agents when to.** `skillCommand`
  is the `skill` command, moved down from cli-messaging, with a new `install [--for claude|agents|all]`
  that writes the file to `~/.claude/skills/<appName>/` and `~/.agents/skills/<appName>/` and records
  the CLI's version as `metadata.version` in its frontmatter — the Agent Skills specification has no
  top-level `version`. It refuses a SKILL.md whose `name` differs from `<appName>`, the directory it
  writes to, which the specification requires to match. `skillHint` is a once-a-day line for an agent whose copy is
  missing or older than the CLI; `skillResource` serves the file to an MCP client as `<command>://skill`.
  An agent used to learn of the skill only by reading `--help`.
  What to watch for: `skillCommand` takes a third argument, the host's renderer, streams and `env`;
  it imports Commander at run time, so a CLI using `/skill` needs Commander installed, as all four do.
- **The update state file keeps a second field, `skillHintAt`,** and `writeUpdateState` now merges
  into the file as it is when written, instead of replacing it, so the two daily notices do not erase
  each other. It accepts a partial state; `readNoticeState` reads the file whether or not npm was asked.
- **`commandsPage` in `@wirecat/cli-core/commands` writes a CLI's whole `docs/commands.md`** from
  the command tree: every command at any depth, its usage, arguments and options with defaults, and
  the exit codes. The table labels come in English and Russian (`COMMANDS_PAGE_LABELS`); the CLI
  passes its own title, introduction and closing words. It is max-cli's generator, moved here so
  tg-cli gets the same page from the same code; max-cli's page comes out byte for byte the same.
- **`structureProblems` in `@wirecat/cli-core/release` checks a docs folder against its
  `meta.json`**, the sidebar the docs portal reads: every listed page exists, every page is listed
  once, the required pages are there (`REQUIRED_PAGES`), `meta.json` holds only Fumadocs' keys,
  and each page has exactly one `# ` heading, first. `README.md` in the folder is left out — it is
  the contributors' index.

### Fixed

- **`Credentials.write` refuses to replace a credentials file it cannot parse.** It used to read a
  broken file as empty, and the next write replaced it, losing every other secret stored in it. Now
  it throws a `CliError` with code `configuration_error` that names the file and never quotes it.
  `read` still treats such a file as holding nothing, and `remove` leaves it alone.
  What to watch for: `write` can now throw when the keyring is unavailable and the file is broken —
  the user fixes the file or moves it aside. An empty file counts as broken.
- **A generated Valibot schema accepts a 64-bit integer enum.** The values are matched as the
  decimal strings a 64-bit integer becomes, as the generated type already said; before, no input
  passed.
- **Generation stops, naming the schema, when an `allOf` reaches its own schema**, directly or
  through others. It used to overflow the stack.

## 0.9.0 — 30.09.2026

### Added

- **`@wirecat/cli-core/release` holds the release checks that max-cli and tg-cli share.** A runner,
  `releaseCheck`, that runs every check and prints one `ok` or `FAIL` line each, and the checks a
  program can decide: a command that must exit 0, the version not yet on npm, the package contents,
  the changelog's shape, links and anchors in the documents, and the version in `package.json` and
  `src/version.ts` in step. Until now each CLI kept its own copy, and the copies had drifted apart.
  Each caller passes its own changelog headings, id prefixes and user pages.

## 0.8.0 — 27.09.2026

### Added

- **`@wirecat/cli-core/codegen` generates an API catalog from an official description, at build
  time.** It reads a format-neutral `ApiModel` — each operation with an `http` or `rpc` binding, an
  effect (`read`, `write`, `destructive`) and how far its source can be trusted — and writes
  TypeScript types, Valibot schemas, an operation manifest and a coverage page. `writeArtifacts`
  writes them, or with `check` only reports which are stale.
  Why: max-cli's bot commands are generated from the MAX Bot API description, and the same machinery
  serves any CLI that has such a description.
  What to watch for: generation stops, naming the problem, on colliding names, an operation not
  classified as a read or a write, an override that matches nothing, an unknown reference or a
  construct it cannot express — it never drops an operation or falls back to `any`. No parser ships:
  the OpenAPI or Postman adapter lives in the CLI that owns the source.
- **`@wirecat/cli-core/codegen/runtime`**, the few number helpers the generated schemas import at run
  time. A 64-bit integer comes out as its exact decimal string from a `lossless-json` number; any
  other integer that does not fit a JS number fails instead of rounding.
  What to watch for: the schemas decode, they do not encode — validate a request with the schema,
  then send the original lossless value.
