# Testing

```sh
pnpm lint            # biome
pnpm typecheck       # the package, then the tests, then scripts/
pnpm test            # vitest
pnpm test:coverage   # the same, with the floor below; CI runs this one
pnpm docs:check      # every relative link and anchor in every .md, and the changelog's shape
pnpm build
pnpm smoke:bun       # the real exports, executed under Bun
pnpm test:slow       # the 20 slowest tests and the 10 slowest files
```

CI runs all but the last, plus a secret scan over the whole history —
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), which calls the same reusable
[`node-ci.yml`](../../.github/workflows/node-ci.yml) the other CLIs call.

## The tests are typechecked

`tsconfig.json` excludes the tests, because it builds `dist/`. `tsconfig.test.json` checks them with
`noEmit`, and `tsconfig.scripts.json` checks `scripts/`. Both add the shared overlays in
[`config/`](../../config) to `tsconfig.json`.

⚠ Both overlays carry `"exclude": []`, and that line is the whole point: `extends` inherits `exclude`, so
without it the test config still excludes every test file and passes having checked nothing
(max-cli learned this — [its TESTING.md](https://github.com/WireCatLabs/max-cli/blob/main/docs/dev/TESTING.md#the-rule-a-skip-is-not-a-pass)).
Checked on 2026-09-29 by putting a type error into a test and watching `pnpm typecheck` fail.

## No test reaches the real machine

[`src/testing/setup.ts`](../../src/testing/setup.ts) is a vitest `setupFiles` entry, so it holds for every test
file, including the next one. It ships as `@wirecat/cli-base/testing/setup`, so a CLI gets the same guarantees
from one line in its `vitest.config.ts`: `setupFiles: ["@wirecat/cli-base/testing/setup"]`
([WC-TEST-1](../standards/testing.md#wc-test-1--point-every-path-a-test-could-write-at-a-temporary-directory)).

- **`TMPDIR`, `TMP`, `TEMP`, `HOME`, the XDG and Windows folders and every `<APP>_*_DIR` already set point into a
  directory of its own, removed when the file is done.** The config,
  credential, logging and update tests make directories with `mkdtempSync(join(tmpdir(), …))` and
  never removed them; one run left 34 in `/tmp`. The setup covers Unix and Windows temporary-path
  selection and restores the inherited environment afterwards. Explicit stack ordering runs its
  cleanup after the file's resource-closing hooks. An interrupted process may leave its root.
- **`@napi-rs/keyring` is replaced by one that throws.** Every test passes `memoryKeyring()`, but
  `Credentials` without a `keyring` falls back to the real keychain — the owner's, where max-cli's
  token lives. `keyring.ts` loads the module through `createRequire`, which `vi.mock` does not reach,
  so the stand-in goes into the require cache. `src/keyring.test.ts` asserts that `systemKeyring`
  throws, and fails without the sandbox — checked once by running it with `--config /dev/null`, which
  does a real keychain read of an entry that does not exist (and can block on a locked keyring's
  prompt). Keep `get` first in that test: without the sandbox it fails there, before `set` and
  `delete` can write anything.
- **No connection leaves the machine.** `net` and `tls` connects, `http(s)` requests, `fetch` and `WebSocket` to
  anything but `localhost`, `127.0.0.1` and `::1` throw an error naming the host, before any name is looked up
  ([WC-TEST-3](../standards/testing.md#wc-test-3--no-test-contacts-a-provider-or-the-network)). A test about the
  network itself calls `onTestFinished(allowNetwork())`. `src/testing/network.test.ts` covers each path.

cli-base has no app name of its own, and every test that resolves paths passes `env` explicitly.

A CLI lists the shared setup first and its own setup file after it, for what is its own (a default profile, pacing
off). Subprocesses inherit the sandbox. Keep deliberate coverage and debug artifacts outside it, with bounded
retention such as one previous command trace. Check the actual temporary parent after a full suite; mocking removal
calls does not prove fixtures were removed. Never clean another session's scratch directory as test teardown.

## No test waits for real

Waits go through an injected `SleepLike`, and `fakeClock()`
from `/testing` records them without waiting. The longest real wait is the child process that
`runUpdate`'s test starts. A new wait gets the injected sleep, never a longer test timeout.

## Coverage has a floor

`vitest.config.ts` holds it: lines 94 %, statements 92 %, functions 90 %, branches 81 % over `src/`,
and **every file at least 50 % of its lines**. The numbers sit just under what the suite reached on
2026-09-29 (94.6 / 92.6 / 91.2 / 82.5). Raise them when coverage rises; never lower them to let a
change through — write the test. Nothing is excluded but the tests themselves; the report is in
`coverage/index.html`.

## Bun

`bun test` cannot run the vitest suite, so [`scripts/smoke.ts`](../../scripts/smoke.ts) runs the real
exports with plain assertions under Bun. A new entry point gets a line there.
