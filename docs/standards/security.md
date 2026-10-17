# Security

**Status: skeleton.** No rules are written here yet.

## Scope

How a CLI keeps secrets and private data safe: secrets never in logs, fixtures or argv, the keyring, error text that
never repeats input, the scanners, and how a vulnerability is reported.

Rule ids on this page are `WC-SECR-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

## Rule template

```markdown
### WC-SECR-<n> · <the rule, in one short sentence>

- **Why:** <one line>.
- **Enforced by:** <check names in backticks, joined by " · ">, or the words "review only".
- **Example:** <a command or a piece of code that keeps the rule>.
- **Exceptions:** <when the rule does not apply>, or "none".
- **Applies to:** <all CLIs, or which ones>. **Since:** cli-base <version>. **Rulings:** <ids>, or "none".
```

## Sources today

Until the rules are written here, these documents hold them:

- [cli-testing security method](https://github.com/WireCatLabs/cli-testing/tree/main/docs/security)
- [the security policy](https://github.com/WireCatLabs/.github/blob/main/SECURITY.md)

## Rules

None assigned yet. Rules and their ids are added when this page is written.
