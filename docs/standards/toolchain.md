# Toolchain

**Status: skeleton.** No rules are written here yet.

## Scope

How a CLI is built and checked before review: strict TypeScript, the shared Biome preset and its grit plugins, the
file size cap, import cycles, spelling and Markdown lint.

Rule ids on this page are `WC-TOOL-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

## Rule template

```markdown
### WC-TOOL-<n> · <the rule, in one short sentence>

- **Why:** <one line>.
- **Enforced by:** <check names in backticks, joined by " · ">, or the words "review only".
- **Example:** <a command or a piece of code that keeps the rule>.
- **Exceptions:** <when the rule does not apply>, or "none".
- **Applies to:** <all CLIs, or which ones>. **Since:** cli-base <version>. **Rulings:** <ids>, or "none".
```

## Sources today

Until the rules are written here, these documents hold them:

- [community standards](https://github.com/WireCatLabs/community/blob/main/standards/README.md)
- [cli-base `TOOLING.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/TOOLING.md)

## Rules

None assigned yet. Rules and their ids are added when this page is written.
