# Changelog

Notable changes to `@wirecat/cli-base` (published as `@wirecat/cli-core` up to 0.20.0), one section per version, newest
first. Versions follow [semantic versioning](https://semver.org/); before `1.0.0` a minor release may change
the API.
Versions before 0.8.0 are in the [git tags](https://github.com/WireCatLabs/cli-base/tags).

Every entry says what changed as a caller sees it, why, and what to watch for — the rules are
[`docs/dev/CONVENTIONS.md`](docs/dev/CONVENTIONS.md#the-changelog).

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
