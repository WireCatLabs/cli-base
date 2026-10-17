# Lifecycle

**Status: skeleton.** No rules are written here yet.

## Scope

How a process starts and ends: a one-shot command exits, a long-running command says so, everything that was opened
is closed before the answer is printed, and an exclusive connection is held by one process only.

Rule ids on this page are `WC-LIFE-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

## Rule template

```markdown
### WC-LIFE-<n> · <the rule, in one short sentence>

- **Why:** <one line>.
- **Enforced by:** <check names in backticks, joined by " · ">, or the words "review only".
- **Example:** <a command or a piece of code that keeps the rule>.
- **Exceptions:** <when the rule does not apply>, or "none".
- **Applies to:** <all CLIs, or which ones>. **Since:** cli-base <version>. **Rulings:** <ids>, or "none".
```

## Sources today

Until the rules are written here, these documents hold them:

- [cli-core `ARCHITECTURE.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/ARCHITECTURE.md)

## Rules

None assigned yet. Rules and their ids are added when this page is written.
