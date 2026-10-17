# Permissions

**Status: skeleton.** No rules are written here yet.

## Scope

What a CLI may do without asking: permission levels and keys, their defaults, the limits no level lifts, the write
guard and its journal.

Rule ids on this page are `WC-PERM-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

## Rule template

```markdown
### WC-PERM-<n> · <the rule, in one short sentence>

- **Why:** <one line>.
- **Enforced by:** <check names in backticks, joined by " · ">, or the words "review only".
- **Example:** <a command or a piece of code that keeps the rule>.
- **Exceptions:** <when the rule does not apply>, or "none".
- **Applies to:** <all CLIs, or which ones>. **Since:** cli-base <version>. **Rulings:** <ids>, or "none".
```

## Sources today

Until the rules are written here, these documents hold them:

- [cli-core `STANDARD.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/STANDARD.md)

## Rules

None assigned yet. Rules and their ids are added when this page is written.
