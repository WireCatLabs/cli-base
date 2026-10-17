import { describe, expect, it } from "vitest"
import { checkChangelog } from "./changelog-guard.ts"

const entry = "- **Changed.** The thing, because of the reason."
const base = (unreleasedHeading: string) =>
  [
    "# Changelog",
    "",
    `## ${unreleasedHeading}`,
    "",
    "### Fixed",
    "",
    "- **Fixed.** Already there.",
    "",
    "## 0.52.0 — 14.10.2026",
    "",
    "### Added",
    "",
    "- **Added.** Shipped.",
    "",
    "## 0.51.0 — 13.10.2026",
    "",
    "- **Added.** Older.",
    "",
  ].join("\n")
const run = (title: string, head: string, heading = "Unreleased", tags = ["v0.52.0", "v0.51.0"]) =>
  checkChangelog({ title, base: base(heading), head, tags })

describe("changelog guard", () => {
  it("rejects a duplicate released heading that would hide new notes before the original body", () => {
    const heading = "## 0.52.0 — 14.10.2026"
    const head = base("Unreleased").replace(heading, `${heading}\n\n${entry}\n\n${heading}`)
    expect(run("docs: merge notes", head)).toMatch(/duplicate heading for 0\.52\.0/)
  })

  it("recognizes the same unreleased version with a v prefix and different date", () => {
    const head = base("Unreleased").replace(
      "## Unreleased",
      "## 0.53.0 — 15.10.2026\n\n- First.\n\n## v0.53.0 — 2026-10-16",
    )
    expect(run("chore(release): notes", head)).toMatch(/duplicate heading for 0\.53\.0/)
  })

  it.each(["Unreleased", "unreleased", "Не выпущено"])("rejects a second pending section named %s", (heading) => {
    const head = base("Unreleased").replace("### Fixed", `## ${heading}\n\n### Fixed`)
    expect(run("docs: pending notes", head)).toMatch(/duplicate heading for unreleased/)
  })

  it("fails a breaking title with no changelog change", () => {
    expect(run("refactor!: drop the flag", base("Unreleased"))).toMatch(/breaking title.*unreleased heading/)
    expect(run("fix(watch)!: line shape", base("Unreleased"))).toMatch(/breaking title/)
  })

  it("passes a breaking title with a new line under the unreleased heading", () => {
    const head = base("Unreleased").replace("- **Fixed.** Already there.", `- **Fixed.** Already there.\n${entry}`)
    expect(run("refactor!: drop the flag", head)).toBeUndefined()
  })

  it("creates the unreleased heading when the base has none", () => {
    const noUnreleased = base("Unreleased").replace(/## Unreleased[\s\S]*?(?=## 0\.52\.0)/, "")
    const head = `${noUnreleased.replace("## 0.52.0", `## Unreleased\n\n${entry}\n\n## 0.52.0`)}`
    expect(checkChangelog({ title: "feat!: x", base: noUnreleased, head, tags: ["v0.52.0"] })).toBeUndefined()
  })

  it("does not count a line added to a released section as the breaking entry", () => {
    const head = base("Unreleased").replace("- **Added.** Shipped.", `- **Added.** Shipped.\n${entry}`)
    expect(run("feat!: x", head)).toMatch(/already released/)
  })

  it("passes a non-breaking title without a changelog change", () => {
    expect(run("fix: a typo", base("Unreleased"))).toBeUndefined()
    expect(run("chore: deps", base("Unreleased"))).toBeUndefined()
  })

  it("fails an edit inside a released section", () => {
    const head = base("Unreleased").replace("- **Added.** Shipped.", "- **Added.** Shipped, and more.")
    expect(run("fix: add to 0.52.0", head)).toMatch(
      /"## 0\.52\.0 — 14\.10\.2026" is already released \(tag v0\.52\.0\)/,
    )
  })

  it("fails removing a released section", () => {
    const head = base("Unreleased").replace(/## 0\.51\.0[\s\S]*$/, "")
    expect(run("docs: tidy", head)).toMatch(/0\.51\.0/)
  })

  it("allows editing a dated section whose tag does not exist yet", () => {
    const head = base("Unreleased").replace("- **Added.** Shipped.", "- **Added.** Shipped, and more.")
    expect(run("docs(changelog): 0.52.0 carries more", head, "Unreleased", ["v0.51.0"])).toBeUndefined()
  })

  it("rejects a second Fixed heading in the unreleased section", () => {
    const head = base("Unreleased").replace("## Unreleased", `## Unreleased\n\n### Fixed\n\n${entry}`)
    expect(run("perf(mail): faster", head)).toMatch(/"Fixed" twice in "Unreleased"/)
  })

  it("rejects a repeated heading in a dated section that is not tagged yet", () => {
    const head = base("Unreleased").replace("## Unreleased", `## 0.53.0 — 15.10.2026\n\n### Fixed\n\n${entry}`)
    expect(run("chore: release 0.53.0", head)).toMatch(/"Fixed" twice in "0\.53\.0 — 15\.10\.2026"/)
  })

  it("lets a pull request through when the base already had the repeat", () => {
    const repeated = base("Unreleased").replace("## Unreleased", "## Unreleased\n\n### Fixed\n\n- **Old.** Repeat.")
    const head = repeated.replace("- **Old.** Repeat.", `- **Old.** Repeat.\n${entry}`)
    expect(checkChangelog({ title: "fix: x", base: repeated, head, tags: ["v0.52.0", "v0.51.0"] })).toBeUndefined()
  })

  it("passes a release pull request that dates the unreleased heading", () => {
    const head = base("Unreleased").replace("## Unreleased", "## 0.53.0 — 15.10.2026")
    expect(run("chore(release): 0.53.0", head)).toBeUndefined()
  })

  it("passes a release pull request that adds the new dated section above the old ones", () => {
    const head = base("Unreleased").replace(
      "## Unreleased",
      "## 0.53.0 — 15.10.2026\n\n- **Added.** New.\n\n## Unreleased",
    )
    expect(run("chore: release 0.53.0", head)).toBeUndefined()
  })

  it("works with the Russian heading", () => {
    const withEntry = base("Не выпущено").replace(
      "- **Fixed.** Already there.",
      `- **Fixed.** Already there.\n${entry}`,
    )
    expect(run("refactor!: x", withEntry, "Не выпущено")).toBeUndefined()
    expect(run("refactor!: x", base("Не выпущено"), "Не выпущено")).toMatch(/breaking title/)
    const edited = base("Не выпущено").replace("- **Added.** Shipped.", "- **Added.** Changed.")
    expect(run("fix: x", edited, "Не выпущено")).toMatch(/already released/)
  })

  it("accepts dotted dates and ISO dates in headings", () => {
    const iso = base("Unreleased").replace("14.10.2026", "2026-10-14")
    const edited = iso.replace("- **Added.** Shipped.", "- **Added.** Edited.")
    expect(checkChangelog({ title: "fix: x", base: iso, head: edited, tags: ["v0.52.0"] })).toMatch(/already released/)
  })
})

describe("restoring immutable release notes", () => {
  const canonical = base("Unreleased")
  const corrupted = canonical.replace("- **Added.** Shipped.", `- **Added.** Shipped.\n${entry}`)
  const restored = canonical.replace("- **Fixed.** Already there.", `- **Fixed.** Already there.\n${entry}`)
  const tagged = (version: string) => (version === "0.52.0" ? canonical : undefined)
  it("allows moving a raced addition to Unreleased while restoring the exact tag section", () => {
    expect(
      checkChangelog({
        title: "fix(changelog): restore release",
        base: corrupted,
        head: restored,
        tags: ["v0.52.0"],
        releasedText: tagged,
      }),
    ).toBeUndefined()
  })
  it("does not read tags for unchanged historical sections", () => {
    expect(
      checkChangelog({
        title: "fix: pending",
        base: corrupted,
        head: corrupted.replace("- **Fixed.** Already there.", entry),
        tags: ["v0.52.0"],
        releasedText: () => {
          throw new Error("must stay lazy")
        },
      }),
    ).toBeUndefined()
  })
  it.each([undefined, () => undefined, () => "# Changelog\n\n## Unreleased\n"])(
    "refuses restoration without a verifiable tagged section",
    (releasedText) => {
      expect(
        checkChangelog({ title: "fix: pending", base: corrupted, head: restored, tags: ["v0.52.0"], releasedText }),
      ).toMatch(/already released/)
    },
  )
  it("refuses partial restoration and invented edits even with tag access", () => {
    const invented = restored.replace("Shipped.", "Invented.")
    expect(
      checkChangelog({
        title: "fix: historical",
        base: corrupted,
        head: invented,
        tags: ["v0.52.0"],
        releasedText: tagged,
      }),
    ).toMatch(/already released/)
    const twiceCorrupted = corrupted.replace("Shipped.", "Shipped.\n- **Extra.** Still wrong.")
    expect(
      checkChangelog({
        title: "fix: partial",
        base: twiceCorrupted,
        head: corrupted,
        tags: ["v0.52.0"],
        releasedText: tagged,
      }),
    ).toMatch(/already released/)
  })
  it("can restore the exact tagged heading as well as its body", () => {
    const wrongDate = corrupted.replace("14.10.2026", "2026-10-15")
    expect(
      checkChangelog({
        title: "fix: release date",
        base: wrongDate,
        head: restored,
        tags: ["v0.52.0"],
        releasedText: tagged,
      }),
    ).toBeUndefined()
  })
})
