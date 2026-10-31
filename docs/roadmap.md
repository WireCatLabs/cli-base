# Roadmap

For developers who build a CLI on `@wirecat/cli-base`. A planned item is not available yet, and the order can change.
There are no dates. What changed in each release is in the [changelog](../CHANGELOG.md).

## What works today

Output for people and programs, closed error codes, the keyring, clocks, the query language, the command tree as
data, code generation from OpenAPI and Google Discovery, release checks and the `cli-dev` lint and audit: see the
[README](../README.md#features) and the [API reference](REFERENCE.md). The rules every WireCat CLI follows are the
[standards handbook](standards/README.md); [New CLI](standards/new-cli.md) starts one with `npx @wirecat/cli-template new`.

## In progress

- **A lint rule that every hand-written list takes a query.**
- **Unique `wcat-<name>` commands.** `wcat` and `wcat shortcuts` work today for a CLI that calls `wcatStart`. Next,
  each CLI installs `wcat-<name>` beside its short name, docs and agent guides move to `wcat <tool> …`, and the short
  `"bin"` goes; the `cli-dev lint` warning then becomes a failure.

## Next

- **Pages that match the code**: the README and the handbook's notes on who follows each rule.
- **An audit that also compares entity schemas and error reasons** across CLIs.
- **A warning that names what keeps a finished command running**, without forcing the process to exit.
- **Windows**: the tests passing there, and a regular check.

## Later

- Code generation from API descriptions other than OpenAPI and Google Discovery.
