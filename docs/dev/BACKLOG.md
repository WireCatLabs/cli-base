# Backlog

Open work for this cycle only, most important first. Someday work is in [BACKLOG_LATER.md](BACKLOG_LATER.md). What
developers can build on today and what comes next is the [roadmap](../roadmap.md). Requests from the CLIs arrive as
[issues](https://github.com/WireCatLabs/cli-base/issues); an accepted one gets a line here.

## Rules

- **An id is permanent** and never reused. Take one with `bin/next-id BASE`: one counter for every worktree on the
  machine, under a lock, and never below the highest number on any branch.
- **One item:** id · priority · title · where the work starts (`path:line`, an issue or a pull request) · details.
  One to three lines; longer analysis goes to a plan beside this page.
- **Priority:** **P1** broken, untrue to users, an install failure or a security problem: done before WireCat is
  advertised · **P2** this cycle · **P3** someday, in [BACKLOG_LATER.md](BACKLOG_LATER.md).
- **Mark:** none — not started · 🚧 `<branch>` — taken · 🟡 — half done, the rest named · ⏸️ — deferred by the owner ·
  🚩 — waits on an owner decision.
- **Claim before code:** put `🚧 <branch>` on the line in the first push of the branch.
- **Close in the pull request that ships the work:** delete the line. The changelog keeps history.

## Launch blockers (P1)

None open.

## Next (P2)

- **BASE-3** · P2 · 🚧 `fix/shared-contract-audit` The audit never measures `same-entity-schema` and `same-error-reason`: both need inputs the
  weekly run and `cli-dev audit --cli` do not pass, so every CLI shows `n/a` (`src/dev/audit.ts:265`).
- **BASE-4** · P2 · A new CLI from a template: [new-cli.md](../standards/new-cli.md) is about 25 manual steps and
  copies `bin/release`, `release.yml` and the release skill "from the nearest CLI". The Slack, Google Meet and
  Notion CLIs are next; a `cli-dev new` or a template repository would make them one step.
- **BASE-5** · P2 · A warning-only helper that names the handles keeping a one-shot command alive (WC-LIFE-1), so
  tg can drop its `process.exit` backstop. [Issue #268](https://github.com/WireCatLabs/cli-base/issues/268).
- **BASE-6** · P2 · 🚧 `fix/standards-list-query-lint` Every hand-written list needs a query (#288).
- **BASE-10** · P2 · Two Base copies in one `node_modules` break every command of a CLI: protected commands live in a
  module-level WeakMap (`src/commands/contracts.ts:21`), so a copy that Core did not bind to finds none. The owner
  ruled one CLI per install: document it, and fail at startup naming both copies' paths and versions.
- **BASE-7** · P2 · Windows: the last platform run failed 14 tests there (file modes, spawning `npm` and `tsc`;
  `README.md`, "Secrets in the OS keyring"), and no CI job runs on Windows, while the keyring promises Credential
  Manager.
