# WireCat CLI standards

This handbook holds the rules every WireCat CLI follows: tools, layout, commands, output, MCP, accounts,
permissions, architecture, the data model, time, tests, security, documents, releases and CI. Read this page first. Then read the page
for the area you are about to change.

It ships in the `@wirecat/cli-base` package. A CLI that depends on cli-base has it at
`node_modules/@wirecat/cli-base/docs/standards/README.md`, at the same version as the `cli-dev lint` it runs.

## How to use this for a new CLI

Start with the [New CLI](new-cli.md) page: `npx @wirecat/cli-template new` makes the repository, and the page lists
the four steps that need a person. A new CLI is ready for its first release when every check under "Done when" passes.

## Which rule wins

1. **The handbook wins over a repository's own documents.** When a `CONVENTIONS.md`, `CLAUDE.md` or `AGENTS.md`
   disagrees with a rule here, the rule here applies, and the repository document is the one to fix.
2. **A repository may be stricter, never looser.** For example, a smaller file size cap is fine. Turning off a
   rule is not.
3. **Product rules stay local.** A rule that only makes sense for one CLI lives in that CLI's `CLAUDE.md`, under
   "Local rules", below a link to this page.
4. **cli-template follows the CLI rules, with a few exemptions by design.** They are listed, with the reason for
   each, on the [New CLI](new-cli.md#the-template-repository-itself) page.

## Areas

| Page | Area id | Rules | What it covers |
|---|---|---:|---|
| [Toolchain](toolchain.md) | `TOOL` | 20 | TypeScript, Biome, grit plugins, size caps, import cycles, spelling, Markdown, Go |
| [Layout](layout.md) | `LAY` | 10 | Repository layout, entry points, exports, file size, one job per file, splitting a unit, the bundled bin |
| [Commands](commands.md) | `CMD` | 29 | Paths, vocabulary, flags, arguments, effects, lifetime, query, help, external references, joining `wcat` |
| [Output](output.md) | `OUT` | 24 | Data on stdout only, envelopes, errors, exit codes, partial answers, projection |
| [MCP](mcp.md) | `MCP` | 13 | The MCP tools, how they come from commands, what each permission shows |
| [Accounts](accounts.md) | `ACCT` | 12 | The explicit profile, reads across accounts, scope flags, linked identities, sign-in commands |
| [Permissions](permissions.md) | `PERM` | 22 | Levels, keys, defaults, hard limits, the write guard and its journal |
| [Architecture](architecture.md) | `ARCH` | 18 | Layers, dependency direction, vendor types, what goes in which package, the command tree built once |
| [Lifecycle](lifecycle.md) | `LIFE` | 15 | Opening late, who closes, deadlines, long-running commands, the `serve` relay, resumable syncs and their request budget, the run log |
| [Store](store.md) | `STORE` | 14 | Store areas, account scope, migrations, test isolation |
| [Data model](data-model.md) | `DATA` | 9 | Core entities, entities and source records, `external_id`, field names, links and duplicates, files, calendar entries |
| [Testing](testing.md) | `TEST` | 17 | Sandbox, no network, no real waits, leak tests, coverage, contracts, test matrix, parity |
| [Security](security.md) | `SECR` | 23 | Secrets, logs, keyring, argv, error text, untrusted text, scanners, workflow hardening, reporting, OAuth sign-in, meeting secrets, keyring in moved-folder runs |
| [Documents](docs.md) | `DOC` | 20 | User pages and developer pages, generated pages, current facts, changelog |
| [Comparisons](comparisons.md) | `CMP` | 11 | Which tools a comparison page lists, rows as user tasks, agents and safety, where others are better, proof of marks |
| [Releases](releases.md) | `REL` | 15 | `bin/release`, the release lock, versions, the owner's yes, trusted publishing |
| [CI](ci.md) | `CI` | 12 | Hooks, the pull request budget, full validation, monthly runs |
| [Time](time.md) | `TIME` | 7 | UTC in the store and in answers, the zone at input and display edges, date-only filters, tests in another zone, the time in answers agents plan by |
| [Style](style.md) | `STYLE` | 10 | Comments, TypeScript habits, commit messages |
| [New CLI](new-cli.md) | — | — | Starting a new CLI from the template: the command, the four manual steps, the checks |
| [Kit surface](kit-surface.md) | — | — | The cli-base and cli-core exports the template is built on, and how a change to one reaches you |

Each count leaves out the ids that moved or merged (see "How ids work").

## How a page is laid out

Every area page has the same parts, in this order:

1. **Scope:** what the page covers, its rule id prefix, and links to the pages that own nearby rules. It may add
   "Words used here" for terms the page defines, and "Who follows these rules today" for known gaps in a CLI.
2. **The rules:** under one `## Rules` heading, or under a few `##` headings that group them by theme.
3. **Planned — not built yet** (only on a page that needs it): an approved design that is not true yet. It has no
   rule ids.
4. **Sources:** a short list of the documents the rules came from. Where one of them disagrees with the page, the
   page holds.

## How a rule is written

Every rule has the same shape. A rule may add a sentence or a short list under its heading, before the bullets.

```markdown
### WC-<AREA>-<n> · <the rule, in one short sentence>

- **Why:** <one line>.
- **Enforced by:** <check names in backticks, joined by " · ">, or the words "review only".
- **Example:** <a command or a piece of code that keeps the rule>.
- **Exceptions:** <when the rule does not apply>, or "none".
- **Applies to:** <all CLIs, or which ones>. **Since:** cli-base <version>. **Rulings:** <ids>, or "none".
```

- **Enforced by** names checks in one of these forms:
  - a check in this repository, cli-base: a `cli-dev lint` or `cli-dev audit` rule (`flag-synonym`), a workflow
    (`ci.yml`, or `ci.yml:ci` for one job), a `pnpm` script (`pnpm standards:check`) or a file by its path
    (`src/keyring.test.ts`). A bare path is always a cli-base file, even when you read this handbook from your own
    CLI's `node_modules`;
  - a check in another repository, as `<repo>: <check>`, such as `cli-core: pnpm parity:check` or
    `cli-core: biome noRestrictedImports`. `<repo>` is the repository's name on GitHub: `cli-core`, `cli-testing`,
    `cli-docs`, `community`, `tg-cli`, `max-cli`, `cli-memo`, `drive-cli`, `zoom-cli`, `whatsapp-cli` or `gcal-cli`. `<app>`
    stands for each CLI the rule applies to, when every one of them runs that check in its own repository.
- **Since** is the cli-base release whose handbook first carried the rule. A feature can be older than its rule.

## How ids work

- A rule id is `WC-<AREA>-<n>`, for example `WC-OUT-3`. The area id is in the table above.
- The `WC-` prefix keeps rule ids apart from other ids in the WireCat repositories.
- Numbers go up within a page and are never reused or renumbered. A new rule takes the next number and goes last on
  its page.
- A rule that moves to another page, or merges into another rule, keeps its id as a one-line entry, so a citation of
  the old id still leads somewhere:

  ```markdown
  ### WC-CI-11 · Moved to [WC-SECR-20](security.md#wc-secr-20--pin-each-third-party-action-to-a-commit-and-give-each-workflow-read-only-defaults)
  ### WC-ARCH-12 · Merged into [WC-LIFE-6](lifecycle.md#wc-life-6--open-nothing-until-an-action-needs-it)
  ```
- A `cli-dev lint` or `cli-dev audit` rule keeps its own kebab-case name, such as `flag-synonym`. The handbook rule
  names it under "Enforced by".

## What `pnpm docs:check` checks here

[`scripts/standards-ids.ts`](https://github.com/WireCatLabs/cli-base/blob/main/scripts/standards-ids.ts) reads every
page and fails when:

- a rule id appears twice, belongs to another page's area, or is out of order on its page;
- a rule has no "Enforced by" line;
- a name in an "Enforced by" line, on any of its lines, is not a known check. A check in this repository must exist.
  A check in another repository cannot be read from here, so only its form is checked: a known repository name, a
  colon and a space, and a check name. Anything else says "review only";
- a "Moved to" or "Merged into" entry points at an id that is not a rule;
- the rule count in the table above differs from the page;
- a page in this folder is not linked from this index.
