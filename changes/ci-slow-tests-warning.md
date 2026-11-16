### Added

- **`node-ci.yml` warns about each test over 3 s** ([WC-TEST-20](../docs/standards/testing.md#wc-test-20--one-test-time-limit-of-15-s-and-each-test-runs-within-3-s)).
  The test run also writes Vitest's JSON report to `coverage/tests.json`, and a `slow tests` step runs
  `cli-dev slow-tests` on it: the slowest tests and files in the log, and a warning annotation for each test over 3 s.
  It never fails the job. With `test-shards` it runs in the `coverage` job on the merged report, so every shard's
  tests count. A run with no report or no `cli-dev` gets a notice instead. A caller gets it by moving its
  `uses: …/node-ci.yml@<sha>` pin; the 3 s warning needs `@wirecat/cli-base` 0.107.0 or later in its lockfile, and an
  older one prints only the slowest tests. No `vitest.config.ts` changes.

### Changed — may break callers

- **`node-ci.yml` names the test reporters on the command line**: `default`, `github-actions` and `json`, in the
  unsharded test run and in the shard merge. That is Vitest's own default in CI plus the JSON report, but it replaces
  any `reporters` a caller sets in `vitest.config.ts`; none sets one today.

### Fixed

- **`cli-dev slow-tests` with no report names the file and how to write it**, and exits 1, instead of a stack trace.
