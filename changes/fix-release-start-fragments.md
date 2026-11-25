### Fixed

- **The shared Start release workflow agrees with `bin/release` on the `changes/` fragments.** When npm already had
  the version in `package.json` and every entry was in `changes/` fragments, `release-start.yml` failed with
  `CHANGELOG.md has no "## Unreleased" to raise …`. Now the new version gets a new section the fragments fill, and
  the run stops only when there are no fragments and the Unreleased section is missing or empty. A
  published `x.0.0` is followed by its next patch, raised only when the entries need more, so `1.0.0` with a fix
  gives `1.0.1` instead of stopping at a major. Every file is checked before any is written, and `after-raise` runs
  once, with the version that ships. The workflow needs cli-dev from cli-base 0.98.0 or later (#714).
