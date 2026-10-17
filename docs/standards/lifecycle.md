# Lifecycle

## Scope

How a process starts and ends: nothing opens before it is needed, the code that opens a resource closes it, a
one-shot command exits, everything that was opened is closed before the answer is printed, an exclusive
connection is held by one process only, and a long sync carries on after a kill.

Rule ids on this page are `WC-LIFE-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md). How a command declares `lifetime` and `cooperative` is on the [commands](commands.md) page. The
exit codes are on the [output](output.md) page.

A "one-shot" command does one job and ends: most commands. A "long-running" command declares
`lifetime: "persistent"` (it runs until it is stopped, such as `serve` or `watch`) or `lifetime: "interactive"` (it
waits for a person, such as a login).

## One-shot commands

### WC-LIFE-1 · The code that opens a resource closes it, so a one-shot command exits when it has answered

- **Why:** a resource with no clear owner is closed twice or never, and a command that prints its answer and then
  hangs blocks every pipe and every agent that waits for it.
- **Enforced by:** review only.
- **Example:** whatever opens a socket, a timer, a listener, a store or a child process closes it in a `finally`, or
  in an equivalent wrapper, on every exit path: success, failure, timeout and cancel. The command context opens the
  services with `withServices` and closes what it opened. A service never closes a connection it was handed, and a
  borrowed connection has a `close` that does nothing. A CLI's bin sets `process.exitCode` and does not call
  `process.exit`, so one handle left open keeps the process alive.
- **Exceptions:** a `persistent` or `interactive` command does not exit after one answer
  ([WC-CMD-18](commands.md#wc-cmd-18--declare-lifetime-and-cooperative-instead-of-matching-command-names)), but it
  still closes what it opened when it stops.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LIFE-2 · Open a one-shot connection with updates off

- **Why:** a connection that listens for updates keeps the process busy after the answer.
- **Enforced by:** review only.
- **Example:** `chats list` connects, reads and closes. Only `watch` and `serve` open with updates on.
- **Exceptions:** a protocol with no connection that has updates off, such as WhatsApp, where the server delivers
  queued messages on every connect. Then the one-shot command does not wait for updates, and whatever arrives is
  either saved to the store or left unacknowledged, so the server delivers it again. It is never acknowledged and
  dropped.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LIFE-3 · Hand what you open to the runner, so a timeout or a signal closes it too

- **Why:** a command cut short never reaches its own `finally` in time.
- **Enforced by:** review only.
- **Example:** register a connection or a store with `trackCloseable` from the command environment. On abort, the
  runner closes every tracked resource. When the command ends, it closes them again and waits at most one second.
- **Exceptions:** none.
- **Applies to:** CLIs that run on cli-core's `run()`. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LIFE-4 · Close what a command opened before its answer counts as final

- **Why:** a close that fails can change the answer, for example a store write that was not committed.
- **Enforced by:** review only.
- **Example:** close the store, then print. Where output is made before the close, hold it in cli-base's
  `createOutputBuffer`, `flush` it only after the close succeeded, and `discard` it on failure. zoom does this for
  every command.
- **Exceptions:** cli-core's runner prints as the command writes and closes tracked resources after. A command on it
  closes its own resources before it returns its answer, and uses the runner's close only as a safety net.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LIFE-5 · Bound every one-shot command by a deadline

- **Why:** a command that waits for ever on a dead connection never fails, so nobody learns why it hangs.
- **Enforced by:** `cli-core: src/cli/deadline.test.ts` · `cli-core: src/cli/program.test.ts`.
- **Example:** the default is 30 seconds. `--timeout 2m` or the `<PREFIX>_TIMEOUT` variable changes it. Past the
  deadline the command fails with `timeout` (exit 9).
- **Exceptions:** a `persistent` command has no deadline and ignores `--timeout`. An `interactive` command has none
  while a person is at the terminal; run headless, it keeps the deadline. `--help` and `--version` need none. A
  background fetch started with `<PREFIX>_BACKFILL_JOB` is bounded only by an explicit `--timeout`.
- **Applies to:** CLIs that run on cli-core's `run()`; other CLIs use cli-base's `createDeadline`. **Since:** cli-base
  0.41.0. **Rulings:** none.

### WC-LIFE-6 · Open nothing until an action needs it

- **Why:** `commands --json`, help and completion must work with no account, database, keyring or network, on a
  machine with a broken config; completion runs on every Tab.
- **Enforced by:** review only.
- **Example:** importing a module opens nothing. A service is a factory over its dependencies, and the connection,
  the store and the account open on first use. A read from the store never connects. Heavy engines (speech, charts,
  PDF) load on first use. The config and the source load only when an action needs them, so `zm --help` works with a
  corrupt config.
- **Exceptions:** none.
- **Applies to:** all CLIs and the shared packages. **Since:** cli-base 0.41.0. **Rulings:** none.

## Long-running commands

### WC-LIFE-7 · Merged into [WC-CMD-18](commands.md#wc-cmd-18--declare-lifetime-and-cooperative-instead-of-matching-command-names)

### WC-LIFE-8 · End a command on Ctrl-C or SIGTERM by aborting the run, and exit with the shell's code

- **Why:** a signal is how a person or a service manager stops a command, and the exit code tells them how it ended.
- **Enforced by:** `cli-core: src/cli/agent-contract.test.ts` · `src/exit-codes.test.ts`.
- **Example:** the signal aborts the run's signal and closes tracked resources. A one-shot command exits 130 on
  Ctrl-C (SIGINT) and 143 on SIGTERM, with a `cancelled` error. A `persistent` command exits 0 on either: being
  stopped is how it ends. A closed pipe (`tg chats list --json | head`) ends quietly with exit 0 and no stack trace.
- **Exceptions:** a run relayed through `serve` adds no signal handlers of its own (WC-LIFE-11).
- **Applies to:** CLIs that run on cli-core's `run()`. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LIFE-9 · Never let an abort hide a write that was in flight

- **Why:** a caller that sees "cancelled" might repeat a send that already went out.
- **Enforced by:** `cli-core: src/cli/deadline.test.ts` · `cli-core: src/cli/execution.test.ts`.
- **Example:** when a timeout or a signal cuts a write that already left, the run fails with `outcome_unknown` and
  names the write's `operation_id`. It is never retried automatically.
- **Exceptions:** none.
- **Applies to:** CLIs that run on cli-core's `run()`. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LIFE-10 · Mark a long command `cooperative` when it should stop at its own pace and keep its work

- **Why:** cutting a long fetch mid-page loses what it already read.
- **Enforced by:** review only.
- **Example:** `annotate(fetch, { cooperative: true })`. The runner then does not cut the command when the run is
  aborted from outside. The command passes the signal to every operation that can be cancelled, checks it before
  each write, and stops after the current step. `persistent` commands count as cooperative.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

## Exclusive connections

### WC-LIFE-11 · Run commands through `serve` when the messenger allows one connection per account

- **Why:** a second connection pushes the first off, so a one-shot command would cut `serve`.
- **Enforced by:** review only.
- **Example:** the messenger sets `Messenger.connection: "exclusive"`. While `serve` holds the connection, a command
  that reaches the messenger is sent to `serve` over a private Unix socket and runs there on the held connection,
  with the client's environment, so the permissions and the read-only lock still hold. Every command that connects,
  a CLI's own commands included, connects through `connectFor`: a relayed run gets serve's own adapter, and a run for
  another profile is refused. With no live `serve`, the command connects on its own. A `serve` that offers the socket
  but does not answer gives `provider_unavailable`, never a second connection.
- **Exceptions:** `serve`, `server`, `bot`, logins, `--offline`, `--dry-run` and `mcp --http` are not relayed.
- **Applies to:** messenger CLIs with an exclusive connection (wa today). **Since:** cli-base 0.41.0.
  **Rulings:** NEED-1389.

## Resumable syncs

A long sync — a mailbox, a chat history, a Drive folder, a recording archive — is stopped by a kill, a reboot or a
provider's limit as often as it ends. These three rules make the next run carry on.

### WC-LIFE-12 · Save a long sync's work per item or per page, so a kill loses nothing saved

- **Why:** a sync that saves only at the end loses hours of work to one kill.
- **Enforced by:** review only.
- **Example:** each page of a chat's history goes into the store in its own transaction as it arrives, and the
  position moves with it. drive saves its first folder walk in its state file as it goes.
- **Exceptions:** none.
- **Applies to:** every CLI with a sync. **Since:** cli-base 0.44.0. **Rulings:** none.

### WC-LIFE-13 · A rerun goes on from where the last run stopped, and starting over is an option

- **Why:** a rerun that lists or pages everything again repeats the work the kill cut short.
- **Enforced by:** `drive-cli: src/sync.test.ts` · `cli-memo: src/mail/import.test.ts`.
- **Example:** a rerun skips what is stored and does not redo the listing or paging that got there. The position
  lives in the store when the store already holds it: tg and max keep the held stretch of each chat, so
  `messages sync --all` skips a chat held to its newest message; memo keeps a resume point per mail folder; zm keeps
  the checkpoint of `recordings sync`. Otherwise it lives in a checkpoint file,
  `<state>/checkpoints/<profile>/<job>.json`, written with `saveCheckpoint` and read with `readCheckpoint` from
  `@wirecat/cli-core/background`. The write is atomic, and a torn file reads as no checkpoint: one run from the start,
  never a failed run. Starting over is `--rescan`, as in `drive personal sync --rescan`; it is in the cli-base flag
  registry.
- **Exceptions:** none. No CLI uses the checkpoint file yet; drive keeps its position in its own state file.
- **Applies to:** every CLI with a sync. **Since:** cli-base 0.44.0. **Rulings:** none.

### WC-LIFE-14 · A sync's status command says how far it is, in one shape

- **Why:** a person or an agent deciding whether to wait or rerun needs the same answer from every CLI.
- **Enforced by:** `cli-core: src/background/checkpoints.test.ts`.
- **Example:** `progressOf` from `@wirecat/cli-core/background` builds
  `{ job, profile, done, total, remaining, state, updated_at, cursor_age_ms }`, and `progressLine` prints it on one
  line in text. `state` is `partial` or `complete`; `total` and `remaining` are `null` when the source does not say how
  much there is. memo's `mail status` answers with it, and the messenger CLIs' `store jobs show` answers with it as
  `progress`.
- **Exceptions:** none. drive and zm print no progress shape yet; that is a known gap. Whether the last scheduled run
  failed is a different question, answered by `recordRun` and `failingNotice` in cli-core's schedules.
- **Applies to:** every CLI with a sync. **Since:** cli-base 0.44.0. **Rulings:** none.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-core `ARCHITECTURE.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/ARCHITECTURE.md)
- [cli-core `STANDARD.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/STANDARD.md), "Agent execution
  contract"
- [cli-base API reference](https://github.com/WireCatLabs/cli-base/blob/main/docs/REFERENCE.md)
- [cli-core `STANDARD.md`, "Resumable syncs"](https://github.com/WireCatLabs/cli-core/blob/9be227198793fabf506ee946b10aaad94d84d519/docs/dev/STANDARD.md#resumable-syncs)
