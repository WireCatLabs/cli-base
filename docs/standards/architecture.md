# Architecture

**Status: skeleton.** No rules are written here yet.

## Scope

How the code is split: the layers and the direction of dependencies, no vendor type above the adapter, and what
belongs in cli-base, in cli-core or in the CLI itself.

Rule ids on this page are `WC-ARCH-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

## Rule template

```markdown
### WC-ARCH-<n> · <the rule, in one short sentence>

- **Why:** <one line>.
- **Enforced by:** <check names in backticks, joined by " · ">, or the words "review only".
- **Example:** <a command or a piece of code that keeps the rule>.
- **Exceptions:** <when the rule does not apply>, or "none".
- **Applies to:** <all CLIs, or which ones>. **Since:** cli-base <version>. **Rulings:** <ids>, or "none".
```

## Sources today

Until the rules are written here, these documents hold them:

- [cli-base `MODULARITY.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/dev/MODULARITY.md)
- [cli-base `ARCHITECTURE.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/dev/ARCHITECTURE.md)
- [cli-core `ARCHITECTURE.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/ARCHITECTURE.md)

## Rules

None assigned yet. Rules and their ids are added when this page is written.
