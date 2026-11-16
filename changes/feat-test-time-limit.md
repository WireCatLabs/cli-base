### Added

- **`cli-dev slow-tests` (`pnpm test:slow`) warns on stderr about each test over 3 s**, and still exits 0. A slow CI
  runner takes up to five times as long, so such a test fails the 15 s limit there while it passes on your machine;
  twice it failed a release. Shrink the test's data; a longer timeout on that one test is not the fix.
- **A new rule in the handbook's [Testing](../docs/standards/testing.md) page**: every repository sets
  `testTimeout: 15_000` in `vitest.config.ts`, and a test that builds big data runs within 3 s on a developer
  machine. A CLI on vitest's default 5 s adds the line to its `vitest.config.ts`; the template seeds it only into new
  CLIs.
