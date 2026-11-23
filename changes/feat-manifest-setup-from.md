### Added

- **The manifest names `signIn.setupFrom` when the CLI has cli-core's setup flow.** WireCat Desktop draws a tool's own
  guided sign-in (`setup show`) only when the tool's catalog entry names `signIn.setupFrom`. A tool added from its
  manifest could not name it, so Desktop showed its plain form instead of the flow. `cli-dev manifest` now writes
  `setupFrom: "0.0.0"` when the CLI has `setup show`, `setup apply` and `setup run` and declares `signIn`. Run
  `pnpm generate` after the bump; nothing else changes. See [the reference](../docs/REFERENCE.md).
