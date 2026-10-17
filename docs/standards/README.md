# WireCat CLI standards

**Status: skeleton.** The pages and the rule format exist. The rules themselves are not written yet, so no rule
id is assigned yet. Until a page has rules, the documents it names under "Sources today" still apply.

This handbook holds the rules every WireCat CLI follows: tools, layout, commands, output, MCP, accounts,
permissions, architecture, tests, security, documents, releases and CI. Read this page first. Then read the page
for the area you are about to change.

It ships in the `@wirecat/cli-base` package. A CLI that depends on cli-base has it at
`node_modules/@wirecat/cli-base/docs/standards/README.md`, at the same version as the `cli-dev lint` it runs.

## Which rule wins

1. **The handbook wins over a repository's own documents.** When a `CONVENTIONS.md`, `CLAUDE.md` or `AGENTS.md`
   disagrees with a rule here, the rule here applies, and the repository document is the one to fix.
2. **A repository may be stricter, never looser.** For example, a smaller file size cap is fine. Turning off a
   rule is not.
3. **Product rules stay local.** A rule that only makes sense for one CLI lives in that CLI's `CLAUDE.md`, under
   "Local rules", below a link to this page.

## Areas

| Page | Area id | What it covers |
|---|---|---|
| [Toolchain](toolchain.md) | `TOOL` | TypeScript, Biome, grit plugins, size caps, import cycles, spelling, Markdown |
| [Layout](layout.md) | `LAY` | Repository layout, entry points, exports, file size, one job per file |
| [Commands](commands.md) | `CMD` | Paths, vocabulary, flags, arguments, effects, lifetime, query, help |
| [Output](output.md) | `OUT` | Data on stdout only, envelopes, errors, exit codes, partial answers, projection |
| [MCP](mcp.md) | `MCP` | The MCP tools, how they come from commands, what each permission shows |
| [Accounts](accounts.md) | `ACCT` | The explicit profile, reads across accounts, scope flags |
| [Permissions](permissions.md) | `PERM` | Levels, keys, defaults, hard limits, the write guard and its journal |
| [Architecture](architecture.md) | `ARCH` | Layers, dependency direction, vendor types, what goes in which package |
| [Lifecycle](lifecycle.md) | `LIFE` | One-shot exits, long-running commands, closing before output |
| [Store](store.md) | `STORE` | Store areas, account scope, migrations, test isolation |
| [Testing](testing.md) | `TEST` | Sandbox, no network, no real waits, coverage, contracts, test matrix, parity |
| [Security](security.md) | `SECR` | Secrets, logs and fixtures, keyring, argv, error text, scanners, reporting |
| [Documents](docs.md) | `DOC` | User pages and developer pages, generated pages, current facts, changelog |
| [Releases](releases.md) | `REL` | `bin/release`, the release lock, versions, release reports, trusted publishing |
| [CI](ci.md) | `CI` | Hooks, the pull request budget, full validation, monthly runs |
| [Style](style.md) | `STYLE` | Comments, TypeScript habits, commit messages |
| [New CLI](new-cli.md) | — | The checklist for starting a new CLI |

## How a rule is written

Every rule has the same shape:

```markdown
### WC-<AREA>-<n> · <the rule, in one short sentence>

- **Why:** <one line>.
- **Enforced by:** <check names in backticks, joined by " · ">, or the words "review only".
- **Example:** <a command or a piece of code that keeps the rule>.
- **Exceptions:** <when the rule does not apply>, or "none".
- **Applies to:** <all CLIs, or which ones>. **Since:** cli-base <version>. **Rulings:** <ids>, or "none".
```

## How ids work

- A rule id is `WC-<AREA>-<n>`, for example `WC-OUT-3`. The area id is in the table above.
- The `WC-` prefix keeps rule ids apart from other ids in the WireCat repositories.
- Numbers go up within a page and are never reused. A rule that no longer holds keeps its heading and says
  "Retired: see WC-…".
- A `cli-dev lint` or `cli-dev audit` rule keeps its own kebab-case name, such as `flag-synonym`. The handbook rule
  names it under "Enforced by".

## What `pnpm docs:check` checks here

[`scripts/standards-ids.ts`](https://github.com/WireCatLabs/cli-base/blob/main/scripts/standards-ids.ts) reads every
page and fails when:

- a rule id appears twice, belongs to another page's area, or is out of order on its page;
- a rule has no "Enforced by" line;
- a name in an "Enforced by" line is not a known check. Known checks are the `cli-dev lint` and `cli-dev audit`
  rules, a workflow in this repository (`ci.yml`, or `ci.yml:ci` for one job), and a `pnpm` script in this
  repository (`pnpm standards:check`). Anything else says "review only";
- a page in this folder is not linked from this index.
