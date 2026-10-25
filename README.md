<img src="https://raw.githubusercontent.com/WireCatLabs/cli-base/main/docs/images/social-preview.png" alt="The foundation for agent-ready CLIs: output for people and machines, stable exit codes, keyring, testable clocks" width="100%">

# @wirecat/cli-base

The foundation for command-line tools that people and AI agents both use. Output for a person and for a program,
a closed error model with stable exit codes, secrets in the OS keyring, injectable clocks, one query language,
the command tree as data — the parts every CLI needs and nobody should write twice.

[Architecture](docs/dev/ARCHITECTURE.md) · [API reference](docs/REFERENCE.md) · [Shared tooling](docs/TOOLING.md) ·
[Testing](docs/dev/TESTING.md) · [Changelog](CHANGELOG.md) · [wirecat.dev](https://wirecat.dev)

[![npm](https://img.shields.io/npm/v/@wirecat/cli-base)](https://www.npmjs.com/package/@wirecat/cli-base)
[![CI](https://github.com/WireCatLabs/cli-base/actions/workflows/ci.yml/badge.svg)](https://github.com/WireCatLabs/cli-base/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/@wirecat/cli-base)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/bun-tested-f9f1e1)](https://bun.sh/)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Key documents

| Document | What it answers |
|---|---|
| [Architecture](docs/dev/ARCHITECTURE.md) | The entry points, the lines this package does not cross, who consumes what |
| [API reference](docs/REFERENCE.md) | What each entry point holds, with examples |
| [Shared tooling](docs/TOOLING.md) | The TypeScript, Biome, lefthook, docs and CI setup a CLI takes from here, and `cli-dev` |
| [Testing](docs/dev/TESTING.md) | The checks, and what each one is for |
| [Conventions](docs/dev/CONVENTIONS.md) | How code here is written |
| [Standards handbook](docs/standards/README.md) | The rules every WireCat CLI follows, one page per area and a new-CLI checklist |
| [CLI standard](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/STANDARD.md) | The messenger-specific rules for tg, max and wa |
| [Roadmap](docs/roadmap.md) | What is being built next for developers on this package |
| [Changelog](CHANGELOG.md) | What each version changed, and what may break callers |

## What it is

Every WireCat tool is built on it: [tg-cli](https://github.com/WireCatLabs/tg-cli),
[max-cli](https://github.com/WireCatLabs/max-cli), and [cli-core](https://github.com/WireCatLabs/cli-core) — the shared
messaging engine — and through it the mail, notes, Zoom and Drive tools.

Up to version 0.20.0 (October 2026) this package was `@wirecat/cli-core`. That name now belongs to the shared
messaging engine: in older changelogs, plans and issues, "cli-core" means this package. Those old
`@wirecat/cli-core` versions (0.18–0.20) are deprecated on npm.

```sh
npm install @wirecat/cli-base
```

It is ESM only, for Node 22 and later: `import` it (`require()` works from Node 22.12). Add `commander` if you use
`/skill`, and `vitest` if you use `/testing/setup`.

**One rule shapes everything here: in a machine mode, stdout carries data and nothing else.** No spinner, no `✓`, no
warning, no ANSI. Diagnostics go to stderr, in every mode including the pretty one. That is the contract a script or
an agent depends on, and `captureStreams` exists so a test can prove nothing leaked across.

```ts
import { captureStreams, createRenderer } from "@wirecat/cli-base"

const streams = captureStreams()
createRenderer({ format: "json", color: false, streams }).result({ chats: 2 })

streams.stdout // ['{"chats":2}']
streams.stderr // []
```

## Architecture

The package is split by **when** a piece runs, so a tool loads only what it calls:

| When | Entry points |
|---|---|
| Every command | root: streams, renderer, errors and exit codes, keyring, credentials, paths, config, time, retry, logging, field selection, output buffer, deadlines |
| Only if the tool speaks HTTP | `/http` |
| Every command that answers | `/standards`: effects, errors, output envelopes, log record, next steps |
| Commands that describe the tool | `/commands`, `/completion`, `/query`, `/skill`, `/mcp`, `/update`, `/standards/tables` |
| Build time | `/codegen`, with a small `/codegen/runtime` for the generated schemas |
| Release time | `/release` |
| Tests | `/testing`: captured streams, memory and broken keyrings, a fake clock |
| Configuration | `biome`, `tsconfig.*.json`, `lefthook.yml`, `cspell` presets |

Three lines this package does not cross:

- **Nothing in the root export is HTTP.** Status classification, `Retry-After` and the fetch seam live in `/http`, so a
  CLI that speaks a WebSocket never carries an HTTP stack.
- **The environment is an argument.** The clock, the sleep, the keyring, `env`, `fetch` and the streams are all
  parameters; the real ones are only defaults. A timeout test finishes instantly, and a keyring test cannot reach a
  real keychain.
- **It logs nothing and prints nothing by itself.** It hands the host a `Logger` interface, a Pino adapter and a
  renderer; what is written, and where, is the host's call.

Five runtime dependencies: valibot and its JSON Schema converter, cli-table3, picocolors and cross-spawn. Commander is
an optional peer: `/commands` and `/completion` use only its types, and `/skill` needs it installed at run time.

## Features

### Output for people and machines

- **Three formats from one renderer:** `pretty` for a person — tables for lists, labelled lines for objects — and
  `json` or `jsonl` for a program. `quiet` keeps only failures.
- **Field selection** (`--json=id,speaker.id`) that keeps the list envelope and the operation ids, and refuses unsafe
  paths.
- **A bounded output buffer.** Output waits until the command succeeds and has closed what it holds; past the limit
  (4 MiB by default) it fails visibly instead of truncating.

### Errors a script can branch on

Fourteen closed error codes, one exit number each: validation, configuration, authentication, permission, not found,
rate limited, timeout, network, provider, outcome unknown and the rest. A script branches on `$?`, an agent on the
`code` and `reason` in one JSON object on stderr. Errors are recognised by a brand, so two installed copies of the
package still understand each other's errors.

### The standard, as data a machine checks

The rules every WireCat CLI follows — the verb vocabulary, the output envelope, the error reasons, next steps, the log
record — live in `/standards` as Valibot schemas that also emit JSON Schema 2020-12.

- **The whole command tree as data.** `describeProgram` walks the live Commander tree, like `rails routes`: every
  command, option, default, conflict and whether it writes. `commands --json` gives it to an agent instead of `--help`.
- **A linter for command trees.** `cli-dev lint` checks a CLI's tree against 19 rules — unknown verbs, filter flags
  that should be query fields, examples that do not run, key casing and more. Known violations live in a baseline
  that may only shrink.
- **An audit across CLIs.** `cli-dev audit` reads several CLIs' command trees and checks them against each other:
  the commands every CLI must have, the same options and output where two CLIs share a path, the same meaning for the
  same flag. Entity-schema and error-reason comparisons require additional inputs; the weekly published-CLI
  run does not supply them and reports `n/a` for those checks.

### One query language for every list

`tasks list state:open priority>1`: a port of the Lucene 9.12.3 parser, with the fields read from the entity's own
schema — strings, choices, numbers, times, booleans, references. A list filters where its data lives, in its store or
at the provider, never in memory; `evaluate` exists only as a test oracle for those compilers. An unknown field fails
with the list of fields that exist.

### Secrets in the OS keyring, on every platform

Credentials resolve environment → keyring → file, warning once and falling through when the keyring refuses.

| Platform | Backing store | Needs installing |
|---|---|---|
| macOS | Keychain, via the Security framework | nothing — part of the OS |
| Windows | Credential Manager | nothing — part of the OS |
| Linux desktop (GNOME, KDE) | Secret Service over D-Bus — `gnome-keyring`, `kwallet` | nothing on a normal desktop; the keyring must be **unlocked** |
| Linux headless, container, WSL, CI | usually **nothing** — no session bus, no secrets daemon | falls back to a `0600` file, with one warning on stderr |
| FreeBSD | Secret Service, same as Linux | same |

**No compiler is involved.** Prebuilt binaries cover twelve platform triples, and the Linux one speaks D-Bus itself,
so libsecret is not a requirement. Checked against `@napi-rs/keyring` 2.1.0 on 2026-09-19.

This repository's CI runs the tests on Linux only. macOS runs the path tests when they change, and that run does not
block a merge (`macos.yml`); nothing runs on Windows here. A CLI built on this library can run its own unit suite
on macOS and Windows through `node-ci.yml` with `platforms: true`; here, Full validation started by hand with
`platforms` does the same. On 2026-10-18 that run passed on macOS and failed 14 tests on Windows (file modes,
spawning `npm` and `tsc`). In every test the keyring is a fake, so no test reaches a real Keychain or Credential
Manager.

Two traps worth designing for: the keyring is global, so a throwaway config directory overwrites the real secret
unless you pass `isolated: true`; and a locked Linux keyring can block on a prompt rather than fail.

### Time, retries and deadlines

- **Monotonic and wall clocks, and one sleep** that both timeouts and backoff use, so a fake clock controls both.
- **Retries with full-jitter backoff**, and a distinction most retry helpers miss: "no answer came" is not "safe to
  repeat". A write whose outcome is unknown stays unknown.
- **Cooperative deadlines.** A timeout waits for the command to settle before it rejects, so resources close in order.

### Files on disk

- **Paths:** the XDG layout on Linux and macOS (`~/.config`, `~/.local/share`, `~/.cache`), `AppData` on Windows,
  each overridable by environment variable.
- **Config** that names the bad field, and an atomic write with the file's own mode. A directory it creates gets
  `0700`; a directory that already exists keeps its mode.
- **Logs** as one JSON record per line with OpenTelemetry field names. A top-level key outside the allow-list is
  written as `[not allowed]`. At any depth, a field named exactly as in `REDACTED_FIELDS` or the program's `redact`
  list (case-sensitive) and a field whose name marks message content are written as `[redacted]`.

### Generated API clients that never guess

`/codegen` turns an API description into TypeScript types, Valibot schemas, an operation manifest and a coverage page.
`adaptOpenApi` reads an OpenAPI 3.0 or 3.1 document; another format needs an adapter in the caller.
Every operation is classified as a read, a write or destructive, with how far the source can be trusted. Generation
stops, naming the problem, on a collision, an unclassified operation or a dangling reference — it never drops an
operation and never falls back to `any`. 64-bit integers stay exact.

### Built for agents and for keeping installs current

- **`skill show` and `skill install`** give a coding agent the CLI's own guide, versioned with the CLI; `skill status`
  says whether each installed copy matches it.
- **MCP setup** for Codex and Claude Code, with a read-only handshake probe.
- **Shell completion** from the command tree, answered from local data only — a shell asks on every Tab.
- **Update checks that never update unasked.** Which package manager installed the CLI, the command that updates it,
  and a daily notice only when a person is at a terminal. A tool holding someone's credentials does not change itself.
- **Release checks** every CLI shares: changelog shape, dead links, package contents, versions in step.

## Engineering

- **Both runtimes, executed.** Node 22+ and Bun; `pnpm smoke:bun` runs the same exports under Bun rather than
  assuming they work.
- **One shared toolchain.** TypeScript, Biome, lefthook, CSpell, a Markdown linter and a reusable CI workflow — install, lint,
  typecheck, test with coverage, build, Bun and a gitleaks scan of the whole history. A CLI takes each piece on its
  own: [Shared tooling](docs/TOOLING.md).
- **`cli-dev`** replaces the scripts every CLI used to copy: version sync, docs checks, slow-test reports, the test
  matrix and the command-tree lint.

```sh
pnpm test        # vitest, Node
pnpm smoke:bun   # the same exports, run under Bun
pnpm lint
pnpm typecheck
pnpm build
```

## Releasing

`bin/release` on `main` starts [`release.yml`](.github/workflows/release.yml), which runs every check and publishes
through npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers/) with provenance — no npm token in
GitHub. It tags `v<version>` once npm shows the new version. The steps are in [RELEASING.md](docs/dev/RELEASING.md); how a release reaches the tools is in the
[architecture](docs/dev/ARCHITECTURE.md#how-a-change-is-published-and-picked-up).

## Licence

[Apache License 2.0](LICENSE).
