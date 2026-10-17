# Accounts

**Status: skeleton.** No rules are written here yet.

## Scope

How a CLI chooses an account: the profile is always explicit, a read across accounts covers all of them and says so,
and scope flags work the same everywhere.

Rule ids on this page are `WC-ACCT-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

## Rule template

```markdown
### WC-ACCT-<n> · <the rule, in one short sentence>

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
