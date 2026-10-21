# Output

## Scope

What a command prints and how it fails: data on stdout and nothing else in machine mode, the envelopes, errors and
exit codes, partial answers, field projection and retries.

Rule ids on this page are `WC-OUT-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md). What a command declares about itself is on the [commands](commands.md) page. How a process ends
on a signal is on the [lifecycle](lifecycle.md) page.

"Machine mode" means `--json` or `--jsonl`. The shapes below are Valibot schemas in cli-base
[`src/standards/output.ts`](https://github.com/WireCatLabs/cli-base/blob/main/src/standards/output.ts) and
[`src/standards/errors.ts`](https://github.com/WireCatLabs/cli-base/blob/main/src/standards/errors.ts). They also emit
JSON Schema 2020-12.

## Streams

### WC-OUT-1 · Put data on stdout and nothing else in machine mode

- **Why:** agents and scripts parse stdout, and one stray line breaks every caller.
- **Enforced by:** review only.
- **Example:** `tg chats list --json | jq .items` gets one JSON value. Notes, warnings, progress and next-step hints go
  to stderr. cli-base's renderer sends every diagnostic to stderr in every mode, and in machine mode it drops the
  `✓` and `·` marks.
- **Exceptions:** an explicit `--help` or `--version` prints text on stdout and exits 0.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-88.

### WC-OUT-2 · Build the human view from the same facts as the machine answer

- **Why:** machine output stays one stable value, and the human view can change freely.
- **Enforced by:** review only.
- **Example:** the command builds one answer object. `--json` prints it whole, and the pretty view draws its items.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-OUT-3 · Fail loudly for what the person asked for, and quietly, with a reason on stderr, for the rest

- **Why:** a side task that breaks must not hide the answer, and a main task that breaks must not look like success.
- **Enforced by:** review only.
- **Example:** a send that fails exits non-zero. A side check nobody asked for that fails writes one line to stderr,
  and the command keeps its own exit code. Once a write is under way, a run log that cannot be written is a warning
  and never changes the exit code.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-97, NEED-133.

## Envelopes

### WC-OUT-4 · Answer every JSON request with one envelope: a list or one thing

- **Why:** a caller reads `items` or `item`, `page` and `meta` in the same place in every command of every CLI.
- **Enforced by:** `cli-core: src/cli/envelope.test.ts` · `cli-core: src/mcp/output-schema.test.ts`.
- **Example:** a list is `{ items, page, next?, missing?, meta }`. One thing is `{ item, next?, missing?, meta }`.
  cli-core builds them with `listOf` and `itemOf`, and its `renderAnswer` refuses any other shape. A list never
  answers a bare array.
- **Exceptions:** a document that is not about the owner's data is printed whole, with no envelope: `commands --json`
  and a `--dry-run` preview.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-358 (its older list shape is replaced by
  this one), NEED-431.

### WC-OUT-5 · Say in `page` how the source pages

- **Why:** a cursor source has no page numbers, and pretending it has them sends the caller to the wrong place.
- **Enforced by:** review only.
- **Example:** `{ mode: "page", limit, has_more, next_page? }`, or `{ mode: "cursor", limit, has_more,
  next_cursor? }` for a source with its own position, such as a message history.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-OUT-6 · End a `--jsonl` stream with one end record

- **Why:** a reader can tell a finished stream from a cut one.
- **Enforced by:** review only.
- **Example:** one `{"type":"item","data":…}` line per item, then `{"type":"end","complete":true,"page":{…}}`, with
  `issues` when a source failed. A one-thing answer is one item line and the end line.
- **Exceptions:** a report that is one object may refuse `--jsonl` with the reason `output.one-object`.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-OUT-7 · Put the facts about the run in `meta`

- **Why:** `run_id` finds the run later, and `complete` says whether the answer can be trusted as whole.
- **Enforced by:** review only.
- **Example:** `{ run_id, duration_ms, accounts?, complete, issues?, truncated?, timezone?, window? }`. `timezone`
  names the zone a time without one was read or shown in, and `window` the UTC bounds a date filter used
  ([Time](time.md)). `complete: false` with
  `issues: [{ code, reason?, source }]` says a source failed or was skipped. `truncated` says a size cap cut the
  answer. Neither one means another page exists: that is `page.has_more`.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-OUT-8 · Exit 0 on a partial answer only when the command declares `partial`

- **Why:** a caller that checks only the exit code must not take half an answer for a whole one.
- **Enforced by:** review only.
- **Example:** a search across accounts declares `annotate(search, { partial: true })` and exits 0 with
  `meta.complete: false`. Any other command prints what it read, then exits with the code of its first issue.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-OUT-9 · Offer at most two next steps, and mark a step safe only when it changes nothing on the service

- **Why:** an agent may run a safe step unasked, so "safe" must be true.
- **Enforced by:** review only.
- **Example:** `next` holds the step to take, then one alternative. Each has `kind` (`command`, or `user_action` with
  no command) and `safe_to_auto_execute`. A step that reads the service and writes only the local store (a sync) is
  safe. A step that reads nothing remotely and writes locally (`store reindex`) is not: it waits to be asked. A step
  is built from ids, counts and cursors the CLI holds, never from text a message, mail or document carried. A CLI
  answer's command step also has `line`, the whole command with the profile (`tg personal mcp config`), because
  `command` is the bare path an MCP router takes and a copied path without the profile fails.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0 (`line`: next release). **Rulings:** none.

### WC-OUT-10 · Answer a write with what it did and its `operation_id`

- **Why:** the id ties the answer to the send journal, and it is how a caller repeats the write safely.
- **Enforced by:** review only.
- **Example:** `{ "item": { "operation_id": "…", … }, "meta": { … } }`, with the ids the write touched beside
  `operation_id`. The same id is in the send journal.
- **Exceptions:** a bot account's send has no `--operation-id`, because no Bot API makes a repeat safe. Logging in
  or linking a device, and logging out or unlinking it, answer without an `operation_id`: they are not in the send
  journal, and the account's state already makes a repeat safe: `wa personal session start` on a linked profile
  answers `already_linked: true`, and a second `session end` answers `ended: false`.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-431.

### WC-OUT-11 · Give a shared command the same answer shape in every CLI of its group

- **Why:** an agent that reads one CLI's answer can read the other's.
- **Enforced by:** `same-path-contract` (weekly audit; it does not block a pull request yet) · `same-entity-schema`
  (not wired yet: no CLI passes its schemas to the audit).
- **Example:** what only one messenger knows goes under `provider_metadata`, never as a top-level field one CLI has and
  the other lacks.
- **Exceptions:** none.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

## Keys and values

### WC-OUT-12 · Use snake_case keys, one meaning per key, and the registered identifier names

- **Why:** a key that changes name or meaning between commands breaks every parser that relied on it.
- **Enforced by:** `key-casing` · `identifier-name`.
- **Example:** `run_id`, never `execution_id` or `log_id`. `operation_id`, never `send_id`. `request_id` and `trace_id`
  are the other registered ids.
- **Exceptions:** keys that are the owner's or a provider's own words stay as written, such as a note's front matter
  or an email's headers. `key-casing` checks the `commands --json` document today; it checks entity schemas only when
  a CLI passes `--schemas`.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-OUT-13 · Write times, durations, references and empty values one way

- **Why:** a caller must not guess whether `0` means "none" or "unknown".
- **Enforced by:** `nullable-list`.
- **Example:** a time is an ISO 8601 string in UTC, ending in `Z`, never epoch milliseconds ([Time](time.md)). A length of time is a number of
  milliseconds in a key ending in `_ms`. A stored thing is named by `ref`. A key that is absent was not asked for or
  is not known. `null` is known to have no value. `[]` is known to be empty, never `null`. `0` is measured, never a
  stand-in for unknown.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

## Errors and exit codes

### WC-OUT-14 · Print a failure in machine mode as one JSON object on stderr, with stdout empty

- **Why:** a caller tells success from failure without parsing text, and stdout never holds half an answer and an
  error.
- **Enforced by:** `src/failure.test.ts` · `cli-core: src/cli/agent-contract.test.ts`.
- **Example:** `{"error":{"code":"not_found","reason":"item.not-found","message":"…","retry":{"safe":false}}}`. The
  keys are `code`, `reason`, `message`, `param?`, `details?`, `next?`, `retry` and `run_id?`. MCP answers the same
  object with `isError`. cli-base's `errorObjectOf` builds it.
- **Exceptions:** with `--debug`, a second JSON line follows it on stderr: the failure's whole record. Under
  `--jsonl`, lines already printed before a failure stay on stdout.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-OUT-15 · Branch on `code` and `reason`, never on `message`

- **Why:** the message is for a person and may change. The code and reason are the contract.
- **Enforced by:** `same-error-reason` (not wired yet: no CLI passes its reasons to the audit).
- **Example:** `reason` is a registered dotted id, such as `query.too-large`, defined with `defineReasons` where it is
  raised. `details` keeps only registered keys, and never a `cause`.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-OUT-16 · Report a failure that is not a `CliError` as `internal_error`, exit 1, with a fixed message

- **Why:** a foreign error's own text can carry anything, including data that must not reach the screen.
- **Enforced by:** `src/failure.test.ts` · `cli-core: src/mcp/result-contract.test.ts`.
- **Example:** `{"error":{"code":"internal_error","reason":"command.crashed",…}}`. No command can raise this code
  itself.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-OUT-17 · Show a person one failure line and at most one next step

- **Why:** a person reads the first line, and a stack trace tells them nothing they can act on.
- **Enforced by:** review only.
- **Example:** `✗ nothing found by that name` and then `→ list the chats: tg work chats list`. `--debug` adds the
  whole record, cause and stack included.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-OUT-18 · Exit with cli-base's code for each kind of failure

- **Why:** a script branches on `$?` without parsing text, and the numbers are the same in every CLI.
- **Enforced by:** `src/exit-codes.test.ts`.
- **Example:** 0 ok · 1 internal error · 2 validation error · 3 configuration error · 4 authentication error ·
  5 permission error · 6 not found · 7 confirmation required · 8 rate limited · 9 timeout · 10 network error ·
  11 provider error · 12 provider unavailable · 13 invalid response · 14 outcome unknown · 130 cancelled.
- **Exceptions:** on cli-core's `run()`, a one-shot command stopped by SIGTERM exits 143. A `persistent` command
  stopped by Ctrl-C or SIGTERM exits 0. A closed pipe exits 0. See the [lifecycle](lifecycle.md) page.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-OUT-19 · Report a wrong command line as `validation_error`, exit 2

- **Why:** an unknown option and a missing argument are failures like any other, in the same shape.
- **Enforced by:** review only.
- **Example:** an unknown command or option, a missing argument or a missing required option prints the error object
  and exits 2. So does a group named without a leaf.
- **Exceptions:** an explicit `--help` or `--version` exits 0.
- **Applies to:** CLIs that run on cli-core's `run()`. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-OUT-20 · Mark a failure safe to retry only when repeating it cannot do harm

- **Why:** an agent repeats a failure marked safe, so a write that may have landed must never be marked safe.
- **Enforced by:** `src/failure.test.ts`.
- **Example:** every error has `retry: { safe, after_ms? }`. A transient failure (`timeout`, `rate_limited`,
  `network_error`, `provider_unavailable`) is safe for a command that writes nothing on the service, or for a write
  that never left (`sent: false`). A sync that only writes the local store is safe to repeat. `outcome_unknown` is
  never safe: repeat that write only with its `--operation-id`.
- **Exceptions:** cli-base's `retryOf`, used on its own, also counts a local write as a write, so it is stricter
  than cli-core's runner.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

## Size and projection

### WC-OUT-21 · Keep only the asked fields with `--json=a,b`, and keep the envelope

- **Why:** an agent pays for every byte it reads, but it still needs to know the answer's limits.
- **Enforced by:** review only.
- **Example:** `tg chats list --json=items.id,items.title`. An answer about one thing takes `item.` the same way:
  `--json=item.profile` keeps `profile` inside `item`. `source.title` picks a nested field. The keys `page`, `next`,
  `missing`, `meta`, `coverage` and `operation_id` stay. A field that does not exist is left out. A bare `--json` at
  a terminal lists the fields of a command that declares its answer, instead of printing them all.
- **Exceptions:** numeric indexes and wildcards are not supported.
- **Applies to:** CLIs that run on cli-core's `run()`; the projector itself (`projectFields`) is cli-base's.
  **Since:** cli-base 0.41.0. **Rulings:** NEED-761.

### WC-OUT-22 · Fail visibly when machine output passes its size cap

- **Why:** a silently cut JSON answer looks whole.
- **Enforced by:** `cli-core: src/cli/execution.test.ts` · `src/failure.test.ts`.
- **Example:** machine output stops at 4 MiB by default. `--max-output-bytes <bytes>` changes it, and 0 turns the cap
  off. Past the cap the command fails with `invalid_response`, reason `output.too-large`, `retry.safe: false`, and
  `partial_output` says whether some output was already printed.
- **Exceptions:** file exports keep their own streaming limits.
- **Applies to:** CLIs that run on cli-core's `run()`; zoom uses cli-base's `createOutputBuffer` for the same cap.
  **Since:** cli-base 0.41.0. **Rulings:** none.

## Agents first

### WC-OUT-23 · When a stable answer for an agent and a nicer view pull apart, the stable answer wins

Three things follow from it:

1. **The machine answer is stable data.** Its shape does not change to read better.
2. **Every action is explicit.** A command does only what its path and options name.
3. **An unknown outcome is not a reason to retry.** When a write may or may not have landed, the answer says so, and
   the caller checks before it repeats anything.

- **Why:** an agent acts on what it parses, so a shape that shifts, a hidden action or an invitation to retry can make
  it do the wrong thing.
- **Enforced by:** review only.
- **Example:** the human view may round, shorten or group what it prints
  ([WC-OUT-2](#wc-out-2--build-the-human-view-from-the-same-facts-as-the-machine-answer)), but `--json` keeps every
  key. A write whose outcome is unknown fails with `outcome_unknown` and `retry.safe: false`
  ([WC-OUT-20](#wc-out-20--mark-a-failure-safe-to-retry-only-when-repeating-it-cannot-do-harm)).
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.44.0. **Rulings:** none.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-core `STANDARD.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/STANDARD.md): agent execution
  contract, output
- [cli-base API reference](https://github.com/WireCatLabs/cli-base/blob/main/docs/REFERENCE.md)
- [cli-core `STANDARD.md`, "External references and our adoption profile"](https://github.com/WireCatLabs/cli-core/blob/022f69fb0acc86f6df05e074ec4df1b911ec94c6/docs/dev/STANDARD.md#external-references-and-our-adoption-profile),
  as it stood before it moved to the handbook (WC-OUT-23)
