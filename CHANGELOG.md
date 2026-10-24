# Changelog

Notable changes to `@wirecat/cli-base` (published as `@wirecat/cli-core` up to 0.20.0), one section per version, newest
first. Versions follow [semantic versioning](https://semver.org/); before `1.0.0` a minor release may change
the API.
Versions before 0.8.0 are in the [git tags](https://github.com/WireCatLabs/cli-base/tags).

Every entry says what changed as a caller sees it, why, and what to watch for — the rules are
[`docs/dev/CONVENTIONS.md`](docs/dev/CONVENTIONS.md#the-changelog).

## Unreleased

### Added

- **`cli-dev audit --groups <file>`** compares the CLIs by the parity groups in that file instead of `PARITY_GROUPS`. The file is a JSON list in the shape `defineParityGroups` takes (`name`, `members`, `covers`, `differences`) and is checked the same way; a bad file stops the run with exit 2 and names the file. A CLI outside WireCatLabs keeps this file in its own repository and lists itself next to our CLIs, with no pull request here. `--differences` still adds to the groups in use, so with both flags it adds to the file's groups. Without the flag nothing changes.
- **`cli-dev <command> --help`** prints the usage, as `cli-dev --help` does, instead of failing on an unknown option.

- **A data-model page in the standards** (`WC-DATA-1` to `WC-DATA-7`, [Data model](docs/standards/data-model.md)). It says which records cli-core owns and which stay private to a CLI, keeps a source's records (a calendar entry, a Drive file, a mail contact) apart from the owner's entities (an event, a document, a person), puts every provider id in `external_id`, lists the standard field names, and makes every link record how it was made, with no link when two candidates tie. Nothing changes in code; older tables follow the rules when they next change.
## 0.51.1 — 24.10.2026

### Fixed

- The shared vocabulary recognizes `--draft` as a switch that saves text for review without sending. Enabling an adapter’s draft capability no longer creates an unknown-option-role lint failure.

### Removed

- **No wait between releases and no weekly limit on breaking changes** (`WC-REL-8`, [Releases](docs/standards/releases.md)). A messenger CLI no longer waits two hours after its last version, and a shared library may ship a change that makes the CLIs change their code at any time. `WC-REL-9` is merged into `WC-REL-8`. The release lock stays. Nothing changes in code.

## 0.51.0 — 24.10.2026

### Added

- **Comparison pages live in the site repository, and our marks are re-checked at each release** (`WC-CMP-11`, [Comparisons](docs/standards/comparisons.md)). The page is written in `cli-docs` (wirecat.dev) because a comparison changes when other tools change, not when we release; the CLI repository keeps a short `docs/compare.md` that links to it. The release report lists the compare page as checked. Nothing changes in code.

### Changed — may break callers

- **Shared command contracts require explicit overrides before host edits.** `sharedCommand`, `assertSharedContracts`, `overrideSharedContract` and `customizeSharedCommand` live in `/commands`; original definitions and exact accepted edits remain available for audits. Independent shell replacements must supply static, exact before/after declarations; a new Core default or a changed provider builder fails until those declarations are reviewed. Provider additions are allowed; inherited subcommands cannot disappear silently. `/commands` now loads Commander at runtime.

- **Cross-CLI contract drift cannot be accepted through a lint baseline.** Declare intentional differences with
  their exact expected values and a specific reason; a changed or stale exemption fails. `audit --complete`
  collects actual schemas and error reasons from `commands info --json` and refuses missing coverage. Canonical capability manifests and validated inherited definitions distinguish explicit provider variants from drift. Global
  options satisfy matching command-local controls, so their placement alone is no longer a divergence.

### Fixed

- **Complete audits keep runtime availability separate from static contracts.** A currently denied or available command retains the same protected grammar and output definition.

- **Command lint distinguishes list filters from computation and output controls.** Ranking weights, timezone, output context and byte pagination remain controls even when an answer exposes similarly named fields; singleton targets are not list filters. Native query fields and id/time filtering remain checked.

## 0.50.4 — 24.10.2026

### Added

- **The shared vocabulary covers knowledge-work resources and receipt delivery.** Registers agents,
  reminders, key documents, evidence answers and the mail archive, with distinct assignment, decision reversal,
  evidence invalidation and receipt acknowledgement actions. Registers the four missing stored meeting
  selector ID flags with target roles. Existing canonical verbs still replace overlapping Memo spellings;
  forum `--topic <id>` keeps its existing meaning, while meeting tags/topics use native query terms.

- **A standard for comparison pages** ([Comparisons](docs/standards/comparisons.md), `WC-CMP-1` to `WC-CMP-10`). A CLI's `docs/compare.md` compares it with the tools a reader would pick for the same job, lists user tasks rather than implementation details, always has an "Agents and safety" group and says where another tool is better (owner, 2026-10-24). Nothing changes in code.

### Fixed

- **Denied commands remain discoverable.** The MCP and permission standards require current availability metadata instead of hiding denied commands. CLI help retains the same capabilities; execution still enforces the permission. This records the owner's discovery rule for every CLI.


- **`sync` covers a two-way mirror.** The vocabulary's meaning of `sync` now says a mirror syncs both ways, so drive's `mirrors sync`, which also writes changes back to Google, uses the verb as defined (owner, 2026-10-24). Nothing changes for one-way syncs.

- **Release checks reject high production dependency findings and audit a fresh npm resolution.** The lockfile-only
  critical gate missed high findings and newer transitive resolutions. Update the reusable workflow pin to adopt
  the checks; fix high findings before releasing. Package packing and resolution disable lifecycle scripts.

## 0.50.3 — 23.10.2026

### Added

- **The vocabulary has `press` and `app` for a messenger's bot buttons.** Verb `press` (press a button under a bot's
  message; the bot sees who pressed it), the owner's word for it (2026-10-23), and view `app` (a bot's mini app: the
  address that opens it). tg and max mount `messages press` and `chats app`, so `unknown-verb` stops reporting them;
  a CLI whose baseline lists them sees "stale baseline entry" and removes the lines.

## 0.50.2 — 23.10.2026

### Added

- **The vocabulary has the words a messenger's bot commands use.** Verbs `answer`, `action` and `watch`; views `me`
  and `between`; resources `callbacks`, `webhooks`, `templates`, `media` and the singular `auth`; flags `--secret`
  (which secret beside a bot token to keep) and `--store-token`. The owner approved them for the shared bot commands
  tg, max and wa mount, so `unknown-verb`, `unknown-resource` and `option-role` stop reporting those commands. A CLI
  whose baseline lists them sees "stale baseline entry" and removes the lines.

- The messenger vocabulary names sign-in sessions, cached metadata, conversations, analysis work and statistics views precisely. Decryption and retry keep distinct meanings; model categories and alternate spellings still use existing words in command migrations.

- The flag vocabulary distinguishes analysis and embedding providers, recorded-consent identities, tag ownership claims, stored-answer models and saved reply-template policies. It also declares the disappearing-message duration, admin-only chat settings, photo removal and sticker-file input with explicit roles.

## 0.50.1 — 23.10.2026

### Fixed

- **Joined-path hints can retain a profile.** `refuseJoinedPath` accepts an optional display prefix so hosts can preserve the caller's profile in the corrected invocation. Existing two-argument calls stay valid.
- **Skill commands have concise summaries.** Detailed installation paths remain in their descriptions, while help and discovery show short task names.

- **Secret checks follow the checked revision.** Shared CI, security and release checks scan its complete reachable history. An unrelated fetched branch can no longer fail a clean pull request.

## 0.50.0 — 22.10.2026

### Changed — may break callers

- **The shared scripts TypeScript configuration checks `vitest.config.ts`.** Consumers extending it now
  catch type errors in their test-runner configuration alongside scripts; fix newly reported errors before upgrading.

- **The handbook clarifies JSON previews and local release validation.** A dry-run preview uses the item
  envelope; local releases must run coverage, engine, contract and security checks, with the npm token
  available only to publishing. Command discovery remains a bare document.

### Added

- **`adaptOpenApi` reads an OpenAPI 3.0 or 3.1 document into the codegen model.** It moved here from max-cli because
  whatsapp-cli needs it too for Meta's Cloud API file. Beyond what max-cli's copy did, it resolves `$ref` parameters,
  drops the `Authorization`, `User-Agent`, `Content-Type` and `Accept` header parameters (the
  HTTP client sets them), reads `oneOf` as a union, `const` and a typeless `enum` as their type, `type: [T, "null"]`
  as nullable, and an array with no `items` as any item. A body that is multipart or a form keeps that in the new
  `ApiBody.contentType` and manifest `request.contentType`; a multipart body with a file wins over a JSON one. A body
  typed only from sample values gets `confidence: "example"`. A path with no `operationId` is skipped instead of
  refused, since Meta uses one to describe its webhook payload. It still stops on anything else it does not
  understand, now under the name `OpenApiError`. Parse YAML yourself and hand it the plain object.
- **One subtype may belong to two discriminated schemas, or to one schema under two values.** The generated type and
  schema accept each value that selects it (`"unsupported" | "unknown"`); before, generation stopped. Meta's sent and
  received message unions share `TextMessage` this way.

- **Release checks can audit Go dependencies for reachable vulnerabilities.** Set `govulncheck: true` and
  `go-version-file` to the module's `go.mod` path. The audit uses that module's Go version and runs in its
  directory; it stays off for existing callers.
- **The weekly cross-CLI audit includes WhatsApp.** Its latest published command tree joins the checks for
  required commands, shared option meanings, answer shapes and error reasons.

## 0.49.0 — 21.10.2026

### Added

- **`parseLucene` can read a phrase's distance.** With `{ proximity: true }`, `"a b"~3` parses as a phrase predicate
  with `slop: 3`, and `queryNodeSchema` accepts `slop`. Meeting search needs it for words spread over neighbouring
  transcript lines, and a caller that turns it on says what the number counts. Without the option `~` is still
  `query.unsupported-operator`, so messages and lists see no change. A distance that is not a whole number is
  `query.invalid-syntax`; `word~2` (fuzzy) stays unsupported either way.

## 0.48.0 — 21.10.2026

### Changed — may break callers

- **The handbook has a Time page, and the shared CI runs tests in `Asia/Vladivostok`.** Every time is stored and
  exchanged in UTC; a zone is applied only where a time with no zone comes in and where a person reads one
  ([`docs/standards/time.md`](docs/standards/time.md), `WC-TIME-1`…`6`). `WC-OUT-13` now asks for ISO 8601 ending
  in `Z`, not any zone. `node-ci.yml` sets `TZ=Asia/Vladivostok` for `test:coverage`, so a test that passed only
  because CI ran in UTC fails. What to watch for: a repository that moves its `node-ci.yml` pin to this release may
  see tests fail that read or print local dates; those are the bugs the Time page names.

### Added

- **`wallTime(value, zone, span)` in `@wirecat/cli-base/query`** reads a time with no zone (`2026-10-21T16:03`,
  optional seconds) as the moment it names in an IANA zone, whatever the process zone. A local time that daylight
  saving skips or repeats is refused with `validation_error`, never guessed. It is the input edge `WC-TIME-3` asks
  for; cli-core's `--since-time` and `--at-time` parsers are to move onto it.
- **`zonedMoment(value, zone, span, { end? })` in `@wirecat/cli-base/query`** reads a typed date or time the way
  `WC-TIME-3` and `WC-TIME-5` ask: a zone the value names wins, a time without one is read in `zone`, a date alone is
  local midnight, or with `end` the last millisecond of that local day.
- **`meta.timezone` and `meta.window`** are allowed in every envelope: the zone a time without one was read or shown
  in, and the UTC `{ since?, until? }` a date filter used.

### Fixed

- **`fakeClock(startMs).now()` starts at `startMs`.** It reported `2 × startMs` plus the time slept, so a test that
  gave a start time saw a different wall time than it set. What to watch for: a test that worked around the doubled
  value now sees the value it passed.

## 0.47.5 — 21.10.2026

### Fixed

- **On Linux the OS keyring now means the Secret Service, never the kernel keyring.** `@napi-rs/keyring` silently
  fell back to the in-memory kernel keyring when the Secret Service did not answer (gnome-keyring locked, D-Bus
  timeout): reads of stored secrets came back empty with no hint why, and writes went to memory that a reboot
  clears. `systemKeyring` now pins every entry to the Secret Service, so such a failure throws and `Credentials`
  in `auto` mode warns once and uses its file. What to watch for: a machine with no Secret Service but a working
  kernel keyring now gets the credentials file instead; a secret written to the kernel keyring by an earlier
  version is no longer read and has to be stored again. The warning now reads "could not reach the OS keyring — it
  may be locked, or no keyring service is running (…); using <file> instead, readable only by you".

## 0.47.4 — 20.10.2026

### Added

- **Selected annotation workflows share the `annotations` resource and explicit `--target-store` and
  `--bindings` flags.** A CLI can export, check and restore derived records without implying a full
  archive backup or choosing destination identities by name. Each command states its included and
  omitted facets; `check` keeps its existing read-only meaning.

## 0.47.3 — 20.10.2026

### Fixed

- **A messenger chat id parses unquoted in a query.** `chat:133…@lid`, `chat:120…@g.us` and `…@s.whatsapp.net` are
  one term now; before, `@lid` was read as minimum-should-match and the query failed with
  `query.unsupported-operator`. An `@` inside a word is part of the value when a letter follows it; `alpha@2` and
  `(a b)@2` are still refused.

## 0.47.2 — 19.10.2026

### Added

- **WC-REL-9 counts a shared-library change toward its once-a-week limit only when a CLI must change its code to take
  it.** cli-core's parity jobs build tg-cli, max-cli and whatsapp-cli from their `main` against every pull request.
  A change all three pass with, unchanged, may ship in any release. A change that fails a job, passes only against a
  CLI branch made for it, or changes behaviour a CLI must adapt to still counts; when in doubt, it counts. The limit
  exists so the CLIs do not chase versions, and a change they need not follow gives them nothing to chase. Its
  changelog still marks it "may break callers" for outside users.

### Removed

- **`--qr-file` is no longer a vocabulary flag.** tg, max and cli-core dropped the option that wrote the login QR
  code to a PNG; a CLI now prints the QR code as text for the user or agent to paste. A CLI that still declares
  `--qr-file` fails `option-role` in `cli-dev lint`; none does today.

## 0.47.1 — 19.10.2026

### Added

- **`--alias <name>` is a vocabulary flag** (role `query`): another name of the thing, searched as its own
  alternative beside its name, repeatable. memo's `projects evidence` takes extra project names with it; before,
  a CLI that wanted the option failed `option-role`.

## 0.47.0 — 18.10.2026

### Added

- **A command step may carry `line`, the whole command to type** (`nextStepSchema`): `tg personal mcp config`, with
  the profile, where `command` stays the bare path the MCP router takes. A CLI fills it, since only it knows the
  profile; `renderError` prints `line` when it is there.

### Fixed

- **The permissions page says wa's `listen` is on main, not released**: WC-PERM-12's "Who follows these rules
  today" said wa pins cli-core 0.341.0 with no `listen`. whatsapp-cli#136 moved wa's main branch to 0.343.0 with
  `listen`, so its one-shot commands save incoming history there; wa 0.1.0, the newest release, still does not.

## 0.46.0 — 18.10.2026

### Added

- **`commandsPage({ …, details })`** closes each command's section with the Markdown paragraphs `details(command)`
  returns. cli-core's `commandHelpMarkdown` gives the Returns, Next usually and Example lines that `--help` shows,
  so `docs/commands.md` says the same as the terminal. Without `details` the page is unchanged.
- **`guide` is a root word in the vocabulary**: a top-level `<tool> guide [name]` (cli-core's scenarios command)
  passes `cli-dev lint` without a baseline entry.

### Fixed

- **The README says which platforms CI covers here:** Linux, plus a non-blocking macOS run of the path tests; no
  Windows job. It read as if the keyring were tested on every platform it lists. `CLEANUP.md` is no longer tracked.
- **Commander is needed at run time by `/skill`,** not only as a type, and the README says so. Full validation
  takes a `platforms` input to run the suite on Windows and macOS by hand; Windows fails 14 tests today.
- **The package no longer ships source maps.** They pointed at `src/`, which is not published, so vitest in every
  consumer printed "Sourcemap … points to missing source files" for each file it loaded from here. Stack traces now
  show the `dist/` JavaScript, which is close to the source.
- **The package now holds `CHANGELOG.md`,** and its npm page links the repository's issues and README.
- **The README gives the install command** and says the package is ESM only (`require()` works from Node 22.12).
- **WC-PERM-12 says that any command saves incoming history under the read-only lock**, not only `serve` and
  `watch`: on a messenger whose history lives in the store and whose adapter has the optional `listen`, cli-core
  0.343.0 saves what arrives during a one-shot command or an MCP session. The lock does not stop it. No messenger
  has `listen` yet.
- **WC-CI-12 now names the required checks in every repository.** The `main` rulesets of whatsapp-cli, cli-core,
  tg-cli, max-cli, cli-base and cli-memo require the pull request validation jobs besides `standards`, so a red pull
  request cannot merge there. drive-cli, zoom-cli, cli-testing and cli-docs have no `pr.yml` and require only
  `standards`. WC-CI-5 lists cli-memo among the repositories with `pr.yml`.

## 0.45.1 — 18.10.2026

### Fixed

- **WC-CI-5 now lists who runs pull request validation and what it costs, as measured.** whatsapp-cli, tg-cli,
  max-cli and cli-core have `pr.yml` beside cli-base; cli-memo, drive-cli, zoom-cli and cli-testing still lack it. A
  run takes 2–3 minutes in the CLIs and about 8 in cli-core, not the two and a half minutes the rule guessed.
- **WC-CI-12 now names what enforces it.** The `main` rulesets of whatsapp-cli and cli-core require the pull request
  validation jobs besides `standards`, so a red pull request cannot merge there; tg-cli, max-cli and cli-base require
  only `standards` and still rely on review.

## 0.45.0 — 18.10.2026

### Changed — may break callers

- **The lint, audit and vocabulary tables moved to `@wirecat/cli-base/standards/tables`.** `VOCABULARY`, `LINT_RULES`,
  `AUDIT_RULES`, `PARITY_GROUPS`, `REQUIRED_ROOTS`, `IDENTIFIERS`, `FIELD_RULES` and their `define…` helpers and types
  are no longer exported from `/standards`, which keeps the run-time contract only: effects, errors, output envelopes,
  the log record and next steps. Every CLI loads `/standards` on start and parsed six dev-only tables it never read
  (82 KB, about 7–12 ms; [measurement](https://github.com/WireCatLabs/cli-testing/tree/main/performance/startup/standards-split-before/README.md)).
  Import the tables from `/standards/tables`; run-time names need no change.
- **Every pull request now runs the full Linux validation, coverage floor included (WC-CI-5).** A `pr.yml` calls the
  repository's own `ci.yml` on `pull_request`, with platform suites skipped and superseded runs cancelled; before,
  tests, coverage, contracts and parity ran only after the merge, so a pull request that lowered coverage passed and
  then broke `main`. WC-CI-4, WC-CI-7, WC-CI-10, WC-TEST-11 and WC-TEST-13 say the same, and cli-base has its own
  `pr.yml`. A CLI adds the workflow shown in WC-CI-5; it costs about two and a half minutes per pull request. Windows,
  macOS and install checks still run only at release, monthly or on request.

## 0.44.5 — 18.10.2026

### Added

- **`node-ci.yml` runs a CLI's whole contract by name**: `cli: true` runs `contracts:check`, `contracts:upgrade`,
  `security:no-leak`, `version:check`, `generate:check`, `test:matrix:check`, `docs:check`, `package:check` and
  `lint:commands` as separate steps after the build (`parity: true` adds `parity:check`); a missing script fails its
  step, and `skip` lists the ones a CLI cannot have yet. `platforms: true` runs the unit suite and the built `bin`
  on Windows and macOS, with `platform-run` for extra commands. All are off by default, so today's callers see no
  change.

## 0.44.4 — 18.10.2026

### Added

- **The handbook catches up with wa**: WC-LIFE-8 lets a one-shot command end a wait it entered with cli-core's
  `untilStopped()` with exit 0, not 130, since stopping is how that wait ends. WC-REL-10 counts whatsapp-cli's
  `bin/release` among the ones that check a signed release report. WC-PERM-18 is stricter: a standing hold (frozen,
  limited, banned) holds every remote write, reactions and read receipts too, and a ban with no end date holds until
  it is lifted.
- **`archive`, `unarchive` and `mark-unread` are vocabulary verbs.** They name the messenger CLIs' commands that
  move a chat into the messenger's own archive and back, and mark a chat unread for the owner alone
  (`chats archive`, `chats unarchive`, `chats mark-unread`). `cli-dev lint` no longer reports them as
  `unknown-verb`. `--backend archive`, the local archive of messages, keeps its meaning. Watch for: once a CLI takes
  this release, `cli-dev lint` fails on its `unknown-verb` baseline entries for these commands as stale until they
  are deleted.
- **`star` and `unstar` are vocabulary verbs.** They name the messenger CLIs' `messages star` and `messages unstar`:
  WhatsApp's starred messages, a mark only the owner sees. Watch for: once a CLI takes this release, `cli-dev lint`
  fails on its `unknown-verb` baseline entries for them as stale until they are deleted.
- **The vocabulary has the words for privacy settings and muted chats.** `privacy` is a resource (an account has one),
  `mute` and `unmute` are verbs, and `account privacy set`'s options (`--find-by-phone`, `--phone-number`, `--calls`,
  `--chat-invites`, `--hide-online`, `--read-receipts`, `--profile-photo`, `--about-text`, `--last-seen`) and
  `chats mute --until` have the role `value`. Why: every messenger CLI that turned these commands on carried up to 13
  command-lint findings in its baseline (`unknown-resource`, `unknown-verb`, `option-role`). Watch for: once a CLI
  takes this release, `cli-dev lint` fails on those baseline entries as stale until they are deleted.

### Changed — may break callers

- **WC-PERM-12 now says what the read-only lock refuses in cli-core 0.337.0**: every write, and every local change
  not marked `destroysNothing`, so a new local write fails closed. Syncs, `serve` and `watch` keep receiving; rebuilt
  indexes, backups, exports, charts and the timed task writes still run; local embedding still runs while text for an
  outside service is refused. A CLI's own local write must be marked, or the lock refuses it.

## 0.44.3 — 18.10.2026

### Added

- **The commands page says when a command reaches another service, not the CLI's own.**
  `annotate(command, { reaches: "other_service" })` marks a command whose remote side is a service other than the
  CLI's own, such as an embedding provider or a model host. The command description and `commands --json` carry
  `reaches: "other_service"`, and `commandsPage` labels it "Sends text to an outside service" (remote write) or "Reads
  from an outside service" (remote read) instead of the CLI's `mutates` line, which said such a command changed
  something in the messenger. The labels come with `COMMANDS_PAGE_LABELS.en` and `.ru`; a CLI's own labels object
  may leave them out, and then the command gets no line. Commands without the field are described as before;
  regenerate `docs/commands.md` once a command sets it.
- **WC-STORE-13 says why keys stay out of the shared store, and allows a per-file media key or reference**: the
  store is what gets backed up, exported, copied and read by agents, so a key there would open an account or a device
  from any copy. A per-file media key (WhatsApp's `mediaKey`) or a per-file reference (a MAX bot's attachment
  `token`) may now be kept in the attachment's `providerRef`: each opens only that one file. Device, session and
  identity keys, account tokens and passwords still stay out.

## 0.44.2 — 18.10.2026

### Added

- `--meeting-inventory` is a registered MCP mode switch for hosts that explicitly bind the shared read-only series inventory tool. Candidate dates stay unverified; the flag does not add a provider connection or widen a default server on its own.

## 0.44.1 — 18.10.2026

### Added

- **Meeting project suggestions have a distinct MCP opt-in.** `--meeting-project-candidates` is registered as a mode switch for hosts that bind the shared read-only candidate SDK. It selects that capability explicitly rather than widening an existing MCP server; consumer hosts still supply the implementation.

## 0.44.0 — 18.10.2026

### Added

- **`cli-dev lint` fails a command with no `effects`** (`missing-command-effects`, WC-CMD-17): every leaf, generated
  ones included, and every group that runs on its own must declare them; a command without them counts as a write,
  so its failures are never retried and no next step runs it unasked. The commands document now says
  `runnable: true` on a group with an action of its own, so the rule can tell it from a group that only prints its
  help — a CLI's groups are checked from the release that picks up this version. tg, max, wa, memo, drive and zoom
  pass it at their current `main`. A reader of `commands --json` that rejects unknown keys must accept `runnable`,
  and an exact comparison of `describeProgram` output gains it on groups such as `doctor`, `mcp` and `commands`.
- **`offline: false` marks a command that cannot answer offline**: `annotate(command, { offline: false })` on a
  command or a group, and `describeProgram` and `commands --json` say `offline: false` on it and on every command
  below it, like `mcp: false`. cli-core's agent catalogue offers an `offline` input on every command that reads the
  service, and a sync or an `inbox` that refuses `--offline` had no way to say so. Nothing changes until a command
  sets it; a reader of `commands --json` that rejects unknown keys must accept the new one.
- **`writeSecurely` writes bytes as well as text**: `contents` takes a `string` or a `Uint8Array` (a `Buffer` is one).
  A login QR image can now be written atomically with mode `0600`, like the credentials file, instead of with
  `writeFileSync` and a `chmod` after it. Callers that pass a string see no change.
- **The vocabulary knows `setup` and `--agent`**: `setup`, the guided first run that logs in and then installs the
  agent skill, is a registered root word, and `setup --agent <agent>` has the `action` role. `cli-dev lint` no
  longer reports them in tg and wa; their `lint/baseline` entries for them turn stale and can be removed.
- **The audit baseline holds wa's shared findings**: `cli-dev audit --for wa --lint wa=lint`, run with the other
  CLIs' command trees, starts with no new finding. What wa shares with the other CLIs was already in the baseline
  under the other CLIs' names.
- **The handbook covers a CLI with a Go part and a messenger with no test accounts**: a new toolchain rule pins Go
  from `go.mod` and runs gofmt, vet and the Go tests; Go keeps its own file names, and the 1,000-line cap is
  TypeScript only. Live checks may use the owner's own chat where no test account exists, no test may open a real
  credential store of any kind, and a release checks every package it publishes. Logging in and out answer without
  an operation id, a flag counts as naming a command in a lower layer, `SECURITY.md` is a user page, and the
  `replies` rules apply only where the messenger has replies. Read the toolchain, layout, style, testing, releases,
  output, architecture, lifecycle, security, permissions and documents pages before the next audit.

### Fixed

- **A query whose `/` opens a regular expression that never closes now says to quote the value.** `/` starts a
  regular expression in the query language, so `text/plain` or `mime:(text/plain)` failed with
  `query.unclosed-literal` and no hint; the message and `details.alternative` now read
  `/ starts a regular expression; put the value in quotes: "text/plain"`. `mime:text/plain` keeps its existing hint,
  `mime:"text/plain"`. The error code and reason are unchanged.
- **`--json=item.<field>` keeps that field**: `projectFields` read `items.` as each listed thing but not `item.` as
  the one answered thing, so `--json=item.profile` printed `item: {}`. It now prints `item: { profile: … }`, as
  `--json=profile` already did.
- **`cli-dev audit` leaves a baseline entry alone when the run lacks one of the CLIs it names**: such an entry was
  counted as fixed, and `--write-baseline` dropped it, so a run over fewer CLIs wiped what a wider run had recorded.
  It now stays in the baseline and is not counted.

## 0.43.5 — 18.10.2026

### Fixed

- **The shared test sandbox no longer fails a test file on Windows when a test left a file open**: the folder is
  retried at exit and otherwise left for the system's temporary-file cleanup, with one line on stderr.

## 0.43.4 — 18.10.2026

### Fixed

- **A test that imitates SIGTERM keeps its sandbox and its worker.** Since 0.43.2 the shared test setup removed every
  sandbox folder and ended the worker on any `SIGTERM` event, so a test calling `process.emit("SIGTERM")` lost its
  files and killed its vitest worker. The setup now acts only on a signal from the operating system, which is still
  how vitest ends a worker after a file fails; a CLI that set other `SIGTERM` listeners aside around such a test can
  drop that.

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
