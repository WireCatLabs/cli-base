# Testing

## Scope

How a CLI is tested: the sandbox, no network and no real waits in tests, what kind of test to write, coverage
floors, offline contracts, the test matrix, parity between CLIs, and the live checks that are not tests.

Rule ids on this page are `WC-TEST-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

Related pages: tests and the shared store are in [Store](store.md); secrets in logs are in [Security](security.md);
typechecking the tests and the Bun smoke test are in [Toolchain](toolchain.md); which checks run on a pull request
and which run after merge is in [CI](ci.md).

### Words used here

- **Sandbox:** a vitest `setupFiles` entry that runs before every test file and moves every path a test could write
  into a temporary directory.
- **Offline contract:** a check that runs the built CLI from outside, with no account and no network, and compares
  its help, its `commands --json` and its MCP tool list with reviewed snapshots. The runner is `cli-contract` from
  `@wirecat/cli-testing`.
- **Test matrix:** the page that lists every command and option of a CLI, with the test that drove it or the reason
  why no offline test can.
- **Full validation:** the CI run on each merge to `main`, on a release and in the monthly run. It is not the pull
  request run.

## Rules

### WC-TEST-1 · Point every path a test could write at a temporary directory

- **Why:** one test that falls back to a default path writes into the owner's config, state, cache or store.
- **Enforced by:** `src/testing/sandbox.test.ts`.
- **Example:** a CLI adopts the shared setup with one line in `vitest.config.ts`:
  `setupFiles: ["@wirecat/cli-base/testing/setup"]`. It holds for every test file, including the next one. Each
  file gets a fresh directory: `TMPDIR`, `TMP`, `TEMP`, `HOME`, `USERPROFILE`, the XDG and Windows folders, and
  every `<APP>_CONFIG_DIR`, `_STATE_DIR` and `_CACHE_DIR` already set, with the store variables
  ([WC-STORE-14](store.md#wc-store-14--tests-never-open-the-owners-store)), point into it. One that is not set falls
  back to the sandboxed home. npm's and pnpm's update check is off (`npm_config_update_notifier=false`,
  `NO_UPDATE_NOTIFIER=1`): with a fresh home, a child `npm` would reach the registry past the network guard and print
  its notice into output a test parses. On macOS the directory is made under `/tmp`, so a Unix socket path under the
  sandboxed home stays within the 104-byte limit. When the file is done, after its own hooks have closed their
  resources, the setup restores the variables and removes the directory; when the file fails while loading or its
  own `afterAll` throws, vitest skips that step and the directory is removed as the worker ends. A CLI's own setup
  file, listed after the shared one, adds only what is its own, such as a default profile.
- **Exceptions:** keep coverage reports and debug traces outside the sandbox, with bounded retention. Never clean
  another session's scratch directory as test teardown.
- **Applies to:** all CLIs and the shared packages. cli-base uses the shared setup; the CLIs keep their own sandboxes
  for now. drive has none yet, and zoom's moves only the temporary directory. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TEST-2 · No test opens a real credential store

- **Why:** the owner's tokens live in the real keychain, and a messenger's device keys in a file of their own; one
  test that forgets an option would read or write the real one.
- **Enforced by:** `src/keyring.test.ts` · `whatsapp-cli: src/testing/sandbox.test.ts`.
- **Example:** every test passes `memoryKeyring()` from `@wirecat/cli-base/testing`. The shared setup
  (`@wirecat/cli-base/testing/setup`, [WC-TEST-1](#wc-test-1--point-every-path-a-test-could-write-at-a-temporary-directory))
  also replaces `@napi-rs/keyring` with a module that throws, so a forgotten option fails the test instead of
  reaching the keychain, and `src/keyring.test.ts` asserts that `systemKeyring` throws under it.
  A credential store that is a file, such as WhatsApp's linked-device keys in `private.db`, resolves under the
  sandbox's state directory, and a sandbox test asserts that its path is inside the temporary root, as wa's does.
- **Exceptions:** none. Until a CLI adopts the shared setup, its sandbox does not replace `@napi-rs/keyring`; tg and
  max only scope the keyring entry through environment variables.
- **Applies to:** all CLIs and the shared packages. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TEST-3 · No test contacts a provider or the network

- **Why:** a test that reaches the network is slow, flaky, and can act on a real account.
- **Enforced by:** `src/testing/network.test.ts`, `max-cli: src/testing/unscripted.ts`.
- **Example:** the shared setup
  ([WC-TEST-1](#wc-test-1--point-every-path-a-test-could-write-at-a-temporary-directory)) refuses every connection
  to anything but `localhost`, any `127.x.x.x` address and `::1` before a name is looked up: `net` and `tls` connects,
  `http(s)` requests, `fetch` and `WebSocket` throw an error that names the host. A test talks to a local server or
  a scripted adapter instead. max-cli's `src/testing/mock-max.ts` scripts the service: an answer per request, a
  refusal, or silence to test a timeout, and a request with no scripted answer fails the test that sent it. tg's
  `scripted({...})` adapter does the same job.
- **Exceptions:** a test whose subject is the network itself calls `onTestFinished(allowNetwork())`, with
  `allowNetwork` from `@wirecat/cli-base/testing`; the guard is back for the next test. Until a CLI adopts the shared
  setup it has no global guard; max's unscripted check and tg's scripted adapter cover only their own service.
- **Applies to:** all CLIs and the shared packages. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TEST-4 · Give a command that must not connect an adapter that throws

- **Why:** a command that swallows an adapter error would otherwise pass while it still connects.
- **Enforced by:** review only.
- **Example:** an `--offline` test passes an adapter that throws "--offline must never open Telegram". When the
  adapter is shared across a file, it is a `vi.fn`, and `afterAll` checks `expect(refuse).not.toHaveBeenCalled()`.
  The test leaves the provider credentials out of `env` to show that none are needed.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TEST-5 · No test waits for real time

- **Why:** a test that sleeps a real second crosses the time limit on a slow CI runner and fails at random.
- **Enforced by:** review only.
- **Example:** waits go through an injected `SleepLike`, and `fakeClock()` from `@wirecat/cli-base/testing` records
  them without waiting. A test harness passes `sleep: async () => {}`. `pnpm test:slow` lists the 20 slowest tests
  and the 10 slowest files.
- **Exceptions:** none. A new wait in the code gets a seam, never a longer test timeout.
- **Applies to:** all CLIs and the shared packages. **Since:** cli-base 0.41.0. **Rulings:** dev-process:4.

### WC-TEST-6 · Test mostly through the command line, with `run()`

- **Why:** a test that drives `run()` checks what a person or an agent types, from parsing to output.
- **Enforced by:** review only.
- **Example:** most tests call `run(["chats", "list", "--json"], environment)` with fake effects and check stdout,
  stderr and the exit code. Unit tests cover pure logic with many cases. Adapter contract cases (cli-core
  `./testing`) cover implementations that must behave the same.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TEST-7 · Write the test that pins a promise someone could break

- **Why:** a test that restates the code passes when the code is wrong; a test of a promise fails.
- **Enforced by:** review only.
- **Example:** reading history marks nothing read; a retried send reuses its id; a send with no answer is
  `outcome_unknown`, never failed and never sent; an ambiguous chat name is refused, not guessed.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TEST-8 · Prove that content does not leak, with a marker and visibly fake data

- **Why:** "the output has no message text" only means something when the text was there to leak; a convention alone
  proves nothing.
- **Enforced by:** review only.
- **Example:** test data is visibly fake: `synthetic text ${id}`, the phone number `+71234567890`, the device id
  `00000000-0000-0000-0000-000000000001`, `your-token-here`. Content that must stay hidden carries a unique marker,
  and the test asserts that the marker is absent from output, errors and run events, while the id is present:
  `expect(err).not.toContain(token)`. The positive check stops the test from passing by recording nothing.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TEST-9 · Give each test its own profile or its own store

- **Why:** the sandbox is per file, so tests in one file share config, the send journal and the store.
- **Enforced by:** review only.
- **Example:** each test passes its own profile name first, or a file-level constant. A test that needs an empty
  store makes a fresh directory and passes `MESSAGING_STORE`.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TEST-10 · A skip is not a pass: report the suite that ran and its counts

- **Why:** a suite that ran nothing, or skipped what mattered, still exits 0.
- **Enforced by:** review only.
- **Example:** when you report work, name the suite that ran and give its counts: passed, failed and skipped. A
  skipped test is counted as skipped, never as passed. That the tests are typechecked at all is
  [WC-TOOL-5](toolchain.md#wc-tool-5--typecheck-every-typescript-file-source-tests-and-scripts).
- **Exceptions:** none.
- **Applies to:** all CLIs and the shared packages. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TEST-11 · Keep a coverage floor, and raise it; never lower it

- **Why:** a floor stops coverage from falling one pull request at a time.
- **Enforced by:** `pnpm test:coverage` · `node-ci.yml:check` · `pr.yml:validation`.
- **Example:** `vitest.config.ts` holds thresholds for lines, statements, functions and branches over `src/`, a little
  under what the suite reaches, and `perFile: { lines: 50 }`. A change that falls below gets a test, not a lower
  number. Each excluded file has its reason written beside it.
- **Exceptions:** generated code, types-only files, the entry point, and code that only runs under Bun or as a
  separate process, each with its reason.
- **Applies to:** all CLIs and the shared packages. memo has no thresholds yet; drive and zoom have no per-file
  floor. **Since:** cli-base 0.41.0. **Rulings:** dev-process:4.

### WC-TEST-12 · Every command and option has a test, or a written reason

- **Why:** a flag that no test passes can break without anyone noticing.
- **Enforced by:** `node-ci.yml:check` · `<app>: pnpm test:matrix:check`.
- **Example:** under vitest, `run()` appends each parsed command path and option name (never a value) to
  `coverage/argv.jsonl`. `pnpm test:matrix` turns that into `docs/dev/test-matrix.md` and fails on a command or
  option with neither a test nor a reason. A reason names the live scenario that covers it. A test that calls a
  function directly does not count.
- **Exceptions:** none.
- **Applies to:** all CLIs. memo's check fails only on a stale page, not yet on an option with no test.
  **Since:** cli-base 0.41.0. **Rulings:** NEED-359.

### WC-TEST-13 · Keep offline contracts for help, discovery, errors and the MCP tool list

- **Why:** agents depend on `commands --json` and the MCP tool list; a change to them must be seen and reviewed.
- **Enforced by:** `node-ci.yml:check` · `<app>: pnpm contracts:check` · `whatsapp-cli: pnpm contracts:check`.
- **Example:** `pnpm contracts:check` runs `cli-contract contracts/plan.json` against the built CLI. It checks the
  help snapshot, that discovery is one JSON value on stdout with empty stderr, that a bad option gives the documented
  exit code and one JSON error on stderr, and the MCP tool names, schemas and annotations. A change is accepted with
  `pnpm exec cli-contract contracts/plan.json --update` and a reviewed diff.
- **Exceptions:** none. The contracts run in full validation, on every pull request and on `main` (WC-CI-5, WC-CI-7).
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TEST-14 · Check the upgrade from the previous published version

- **Why:** a release that cannot read what the previous one wrote loses the owner's data.
- **Enforced by:** `node-ci.yml:check` · `<app>: pnpm contracts:upgrade`.
- **Example:** `pnpm contracts:upgrade` runs the previous published package and this build on the same synthetic
  state and checks that the data survives. Each store migration also has its own upgrade test (WC-STORE-9).
- **Exceptions:** a CLI with no local state.
- **Applies to:** all CLIs with local state. wa has no upgrade contract yet. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TEST-15 · A refactor keeps `commands --json` and the MCP tool list as they were

- **Why:** a change that is meant to move code must not change what agents see.
- **Enforced by:** review only.
- **Example:** capture `commands --json` and the MCP tool list from `main` before the first edit, and compare them
  after the last. The offline contract snapshots (WC-TEST-13) do the same job in full validation.
- **Exceptions:** a refactor that changes behaviour on purpose says so in its pull request.
- **Applies to:** all CLIs and cli-core. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TEST-16 · A messenger CLI matches its column of the parity manifest

- **Why:** tg, max and wa promise the same commands and options where their messengers allow it.
- **Enforced by:** `<app>: pnpm parity:check` · `cli-core: parity.yml` · `cli-core: src/parity/manifest.test.ts`.
- **Example:** `pnpm parity:check` compares the CLI's `commands --json` with its column of `parity.json` from the
  cli-core version it installed. cli-core's `parity.yml` builds tg, max and wa from `main` and runs the same check in
  full validation.
- **Exceptions:** a row marked `planned` passes whether the command exists or not.
- **Applies to:** messenger CLIs (tg, max, wa). **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-TEST-17 · Merged into [WC-TOOL-6](toolchain.md#wc-tool-6--support-node-22-and-later-and-bun-and-run-the-built-exports-under-bun)

### WC-TEST-18 · Check the real service by hand, never in the test suite

- **Why:** a check against a real account needs a live login and can send messages to people.
- **Enforced by:** review only.
- **Example:** live scenarios run by hand, by the owner or with the owner's yes, on test profiles and test chats
  only. The cast lives in an ignored file, no profile is assumed, and the record keeps the shape of each answer,
  never its content. When a scenario is run again, the sentence it supports is updated.
- **Exceptions:** a messenger with no test accounts, such as WhatsApp, where a second account or a second linked
  device would change the owner's real one, runs live scenarios on the owner's profile and only in the owner's own
  chat (the chat with themselves). It never writes to another person, and still runs only with the owner's yes.
- **Applies to:** all CLIs that talk to a real account. **Since:** cli-base 0.41.0. **Rulings:** none.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-base `TESTING.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/dev/TESTING.md)
- [cli-core `TESTING.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/TESTING.md)
- [max-cli `TESTING.md`](https://github.com/WireCatLabs/max-cli/blob/main/docs/dev/TESTING.md)
- [cli-testing contracts guide](https://github.com/WireCatLabs/cli-testing/blob/main/docs/ci/CONTRACTS.md) and
  [upgrade guide](https://github.com/WireCatLabs/cli-testing/blob/main/docs/ci/UPGRADES.md)
- [cli-testing CI docs](https://github.com/WireCatLabs/cli-testing/tree/main/docs/ci)
