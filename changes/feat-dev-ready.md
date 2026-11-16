### Added

- **`cli-dev ready [--json]` says whether a CLI is ready to release, row by row, with evidence.** It runs the CLI's
  own scripts in order: typecheck and lint, tests with `contracts:check`, the family audit, `docs:check`,
  `generate:check` when `spec/` exists, `smoke`, `security:no-leak` and `deps:check`. It reads the live-check record
  for the version. Each row is verified, partially, not verified or unsupported, and names its evidence: the script
  that passed or the last lines of its failure, the test files that call the category's cli-core contract (the
  category comes from `docs/dev/DESIGN.md`), the record's line in `docs/dev/live-checks.txt`. A missing script is not
  verified; nothing is verified on inference. It prints the one next step and exits 1 until every row is verified or
  unsupported. [New CLI](../docs/standards/new-cli.md#done-when)
