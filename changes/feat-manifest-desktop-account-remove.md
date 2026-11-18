### Added

- **The manifest tells WireCat Desktop how to remove an account.** `desktop.accountRemove` is written from the
  command tree: `signOut` when the CLI has `session end`, `remove` when its `account remove` takes `--keep-data`,
  `--delete-data` and `--dry-run`. The key is left out for a CLI with neither, because a Desktop that does
  not read it refuses the whole manifest. See [the reference](../docs/REFERENCE.md).
