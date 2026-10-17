# CI

**Status: skeleton.** No rules are written here yet.

## Scope

What runs where: the local hooks, the checks on every pull request and their time budget, full validation on merge,
and the monthly runs.

Rule ids on this page are `WC-CI-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

## Rule template

```markdown
### WC-CI-<n> · <the rule, in one short sentence>

- **Why:** <one line>.
- **Enforced by:** <check names in backticks, joined by " · ">, or the words "review only".
- **Example:** <a command or a piece of code that keeps the rule>.
- **Exceptions:** <when the rule does not apply>, or "none".
- **Applies to:** <all CLIs, or which ones>. **Since:** cli-base <version>. **Rulings:** <ids>, or "none".
```

## Sources today

Until the rules are written here, these documents hold them:

- [community standards](https://github.com/WireCatLabs/community/blob/main/standards/README.md)
- [community `CHECKS.md`](https://github.com/WireCatLabs/community/blob/main/standards/CHECKS.md)
- [cli-testing CI docs](https://github.com/WireCatLabs/cli-testing/tree/main/docs/ci)

## Rules

None assigned yet. Rules and their ids are added when this page is written.
