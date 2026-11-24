### Fixed

- **`bin/release` collects the `changes/` fragments and never renames a published section.** When npm already had
  the version in `package.json` and only fragments had merged, it renamed that version's heading (`## 0.131.0` to
  `## 0.132.0`), moved the published entries under the new number and left the fragments out (#706). Now a published
  section keeps its heading: the new version takes the Unreleased section, or a new section the fragments fill, and
  the release stops when there is neither. The fragments are collected into the version's section, which may raise
  it to the level they need (an Added is a minor), as the CLIs' `bin/release` does. See
  [RELEASING.md](../docs/dev/RELEASING.md).
