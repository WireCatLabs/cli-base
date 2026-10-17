# Testing

**Status: skeleton.** No rules are written here yet.

## Scope

How a CLI is tested: the sandbox, no network and no real waits in tests, coverage floors, offline contracts, the
test matrix, parity between CLIs, and tests mostly through the command line.

Rule ids on this page are `WC-TEST-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

## Rule template

```markdown
### WC-TEST-<n> · <the rule, in one short sentence>

- **Why:** <one line>.
- **Enforced by:** <check names in backticks, joined by " · ">, or the words "review only".
- **Example:** <a command or a piece of code that keeps the rule>.
- **Exceptions:** <when the rule does not apply>, or "none".
- **Applies to:** <all CLIs, or which ones>. **Since:** cli-base <version>. **Rulings:** <ids>, or "none".
```

## Sources today

Until the rules are written here, these documents hold them:

- [cli-base `TESTING.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/dev/TESTING.md)
- [cli-testing CI docs](https://github.com/WireCatLabs/cli-testing/tree/main/docs/ci)

## Rules

None assigned yet. Rules and their ids are added when this page is written.
