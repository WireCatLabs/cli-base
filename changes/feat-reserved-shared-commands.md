### Added

- **`cli-dev lint` reports a command at a path cli-core reserves when the CLI built it itself.** The paths are
  `session start`, `session status`, `session end`, `session list`, `doctor`, `mcp`, `account remove`, `mirrors` and
  `complete`. The new rule `reserved-shared-command` reads `commands --json` and names each such path that has no
  `origin: "cli-core"`, with the cli-core helper to mount instead. Audits found own sessions, an own `mirrors`, an own
  `doctor` and an own MCP server in several CLIs, and no check saw them, because `assertSharedContracts` looks only at
  commands cli-core marked. For now it is a warning in `cli-dev lint` and in the family audit, so no CI run fails on
  it. It becomes an error in a later release, planned for 2027-01-15, once cli-core marks `tokenSessionCommand`,
  `oauthSessionCommand`, `fileMirrorsCommand` and `accountRemoveCommand`. Until then a CLI that mounts one of those is
  reported too. A deliberate difference goes in `lint/overrides.json` with its reason, owner and `review_after`. An
  entry for this rule in `lint/baseline/` fails the lint, because it has no reason or date. The rule is
  [WC-CMD-34](../docs/standards/commands.md#wc-cmd-34--mount-cli-cores-shared-command-at-a-reserved-path-never-one-of-your-own).
