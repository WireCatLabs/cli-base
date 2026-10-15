import { describe, expect, it } from "vitest"
import { foldUnreleased, mergeRepeatedHeadings } from "./fold.js"

const changelog = `# Changelog

Intro.

## Unreleased

### Added

- New thing.

### Fixed

- Newer fix.

## 0.9.0 — 14.10.2026

### Fixed

- Older fix.

## 0.8.0 — 01.10.2026

### Added

- Old thing.
`

describe("foldUnreleased", () => {
  it("merges Unreleased into the dated version below it, same headings together, newest first", () => {
    expect(foldUnreleased(changelog, "0.9.0")).toBe(`# Changelog

Intro.

## 0.9.0 — 14.10.2026

### Added

- New thing.

### Fixed

- Newer fix.
- Older fix.

## 0.8.0 — 01.10.2026

### Added

- Old thing.
`)
  })

  it("leaves the changelog alone when the section below Unreleased is another version", () => {
    expect(foldUnreleased(changelog, "0.10.0")).toBeUndefined()
  })

  it("leaves the changelog alone when the top section is already dated", () => {
    expect(foldUnreleased(changelog.replace("## Unreleased", "## 0.10.0 — 15.10.2026"), "0.10.0")).toBeUndefined()
  })

  it("drops an empty Unreleased", () => {
    const empty = "# Changelog\n\n## Unreleased\n\n## 0.9.0 — 14.10.2026\n\n### Fixed\n\n- Older fix.\n"
    expect(foldUnreleased(empty, "0.9.0")).toBe("# Changelog\n\n## 0.9.0 — 14.10.2026\n\n### Fixed\n\n- Older fix.\n")
  })

  it("folds a changelog whose unreleased section has another title", () => {
    const russian = changelog.replace("## Unreleased", "## Не выпущено")
    expect(foldUnreleased(russian, "0.9.0", "Не выпущено")).toBe(foldUnreleased(changelog, "0.9.0"))
    expect(foldUnreleased(russian, "0.9.0")).toBeUndefined()
  })

  it("refuses text under Unreleased that has no heading, rather than losing it", () => {
    const loose = changelog.replace("## Unreleased\n", "## Unreleased\n\nA stray line.\n")
    expect(() => foldUnreleased(loose, "0.9.0")).toThrow(/before its first ### heading/)
  })

  it("merges a heading the dated section already repeats", () => {
    const repeated = changelog.replace(
      "### Fixed\n\n- Older fix.",
      "### Fixed\n\n- Older fix.\n\n### Fixed\n\n- Oldest fix.",
    )
    expect(foldUnreleased(repeated, "0.9.0")).toContain(
      "### Fixed\n\n- Newer fix.\n- Older fix.\n- Oldest fix.\n\n## 0.8.0",
    )
  })

  it("merges headings that differ only by trailing spaces", () => {
    expect(foldUnreleased(changelog.replace("### Fixed\n\n- Older", "### Fixed  \n\n- Older"), "0.9.0")).toBe(
      foldUnreleased(changelog, "0.9.0"),
    )
  })
})

describe("mergeRepeatedHeadings", () => {
  // cli-core 0.294.0 after #1327 (branched before the fold) merged: its Unreleased hunk landed under the date.
  const landed = `# Changelog

## 0.294.0 — 15.10.2026

### Added

- **A message draws the poll it carries**.

### Fixed

- Model requests needing verbatim source evidence can set \`allowSourceQuotes: true\`.

### Added

- **Native archive writer leases in \`@wirecat/cli-core/files\`.**
- **Search finds a letter by a whole tracking link and by a part of a link.**

### Changed — may break callers

- **The personal MCP catalogue is no longer exported**.

## 0.293.0 — 15.10.2026

### Added

- Older.
`

  it("leaves one Added in the dated section, entries in their order", () => {
    expect(mergeRepeatedHeadings(landed, "0.294.0")).toBe(`# Changelog

## 0.294.0 — 15.10.2026

### Added

- **A message draws the poll it carries**.
- **Native archive writer leases in \`@wirecat/cli-core/files\`.**
- **Search finds a letter by a whole tracking link and by a part of a link.**

### Fixed

- Model requests needing verbatim source evidence can set \`allowSourceQuotes: true\`.

### Changed — may break callers

- **The personal MCP catalogue is no longer exported**.

## 0.293.0 — 15.10.2026

### Added

- Older.
`)
  })

  it("leaves a section without repeats, another version, and an unreleased top alone", () => {
    expect(mergeRepeatedHeadings(mergeRepeatedHeadings(landed, "0.294.0") ?? "", "0.294.0")).toBeUndefined()
    expect(mergeRepeatedHeadings(landed, "0.295.0")).toBeUndefined()
    expect(mergeRepeatedHeadings(changelog, "0.9.0")).toBeUndefined()
  })
})
