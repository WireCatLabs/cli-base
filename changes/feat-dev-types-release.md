### Added

- **`cli-dev version` checks a CLI's override of `@wirecat/cli-core` (WC-TOOL-21).** cli-core's `X.Y.Z` now ships no
  type files, and its `X.Y.Z-dev` is the same code with them. A CLI pins `X.Y.Z` in `package.json` and overrides it to
  `X.Y.Z-dev` under `overrides:` in `pnpm-workspace.yaml`, which its users never read. `cli-dev version` fails when the
  override names another version, or is missing while the installed cli-core has no types, and prints the line to
  write. It only notes a missing override while the CLI pins a cli-core released before the `-dev` releases.
  `cli-dev adopt` now moves the override with the pin
  ([Toolchain](../docs/standards/toolchain.md#wc-tool-21--pin-cli-core-xyz-and-override-it-to-xyz-dev-at-the-root)).
