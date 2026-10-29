import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { landChange, landFold, newestTag, restoreChange, type Shell } from "./land.js"

const dated = "# Changelog\n\n## 0.9.0 — 14.10.2026\n\n### Fixed\n\n- Older fix.\n"
const stacked = dated.replace("## 0.9.0", "## Unreleased\n\n### Fixed\n\n- Newer fix.\n\n## 0.9.0")
const folded = dated.replace("- Older", "- Newer fix.\n- Older")
const PR = "https://github.com/o/r/pull/7"

let file: string
let calls: string[]
let logs: string[]

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), "cli-dev-land-")), "CHANGELOG.md")
  writeFileSync(file, stacked)
  calls = []
  logs = []
})

const fakeShell = (answer: (call: string) => { ok?: boolean; out?: string } | undefined): Shell => ({
  run: (command, args) => {
    const call = [command, ...args].join(" ")
    calls.push(call)
    const given = answer(call)
    return { ok: given?.ok ?? true, out: given?.out ?? (call.startsWith("gh pr create") ? PR : "") }
  },
  sleep: () => {},
})

const land = (shell: Shell) =>
  landFold({ file, version: "0.9.0", unreleased: "Unreleased", shell, log: (t) => logs.push(t) })

const mergeableOnce = (states: string[]) => (call: string) =>
  call.includes("--json mergeable") ? { out: states.shift() ?? "MERGEABLE" } : undefined

describe("landFold", () => {
  it("folds on a fresh main, waits for the checks and squash-merges", () => {
    const answer = mergeableOnce(["UNKNOWN", "MERGEABLE"])
    expect(land(fakeShell((c) => answer(c) ?? (c.includes("--jq length") ? { out: "3" } : undefined)))).toBe(
      `folded Unreleased into 0.9.0 (${PR})`,
    )
    expect(readFileSync(file, "utf8")).toBe(folded)
    expect(calls.slice(0, 2)).toEqual(["git fetch -q origin", "git merge -q --ff-only origin/main"])
    expect(calls).toContain(
      `gh pr merge ${PR} --squash --delete-branch --subject chore(release): fold Unreleased into 0.9.0 (#7)`,
    )
    expect(calls.some((c) => c.startsWith("gh pr close"))).toBe(false)
  })

  it("closes a pull request that conflicts and stops when the new main is already folded", () => {
    const answer = mergeableOnce(["CONFLICTING"])
    let fetches = 0
    const shell = fakeShell((c) => {
      if (c.startsWith("git merge -q --ff-only") && ++fetches === 2) writeFileSync(file, folded)
      return answer(c)
    })
    expect(land(shell)).toBeUndefined()
    expect(calls).toContain(`gh pr close ${PR} --delete-branch`)
    expect(calls.filter((c) => c.startsWith("gh pr create"))).toHaveLength(1)
    expect(calls.some((c) => c.startsWith("gh pr checks"))).toBe(false)
    expect(logs.at(-1)).toContain("nothing to land")
  })

  it("folds again once when main moves under the pull request while its checks run", () => {
    let merges = 0
    const answer = mergeableOnce(["MERGEABLE", "CONFLICTING", "MERGEABLE"])
    const shell = fakeShell((c) => {
      if (c.startsWith("git merge -q --ff-only") && merges === 1)
        writeFileSync(file, stacked.replace("Newer", "Newest"))
      if (c.startsWith("gh pr merge")) return { ok: ++merges > 1 }
      return answer(c) ?? (c.includes("--jq length") ? { out: "1" } : undefined)
    })
    expect(land(shell)).toBe(`folded Unreleased into 0.9.0 (${PR})`)
    expect(readFileSync(file, "utf8")).toContain("- Newest fix.\n- Older fix.")
    expect(calls.filter((c) => c.startsWith("gh pr close"))).toHaveLength(1)
    expect(calls.filter((c) => c.startsWith("gh pr create"))).toHaveLength(2)
  })

  it("gives up after the second conflict", () => {
    const shell = fakeShell((c) => {
      if (c.startsWith("git merge -q --ff-only")) writeFileSync(file, stacked)
      return c.includes("--json mergeable") ? { out: "CONFLICTING" } : undefined
    })
    expect(() => land(shell)).toThrow(/twice/)
    expect(calls.filter((c) => c.startsWith("gh pr close"))).toHaveLength(2)
  })

  it("stops without merging when the checks fail", () => {
    const shell = fakeShell((c) =>
      c.includes("--watch") ? { ok: false } : c.includes("--jq length") ? { out: "1" } : undefined,
    )
    expect(() => land(shell)).toThrow(/checks failed/)
    expect(calls.some((c) => c.startsWith("gh pr merge"))).toBe(false)
  })

  it("lands a merge of repeated headings when nothing sits above the dated section", () => {
    writeFileSync(file, `${dated}\n### Fixed\n\n- Oldest fix.\n`)
    const shell = fakeShell((c) => (c.includes("--jq length") ? { out: "1" } : undefined))
    expect(land(shell)).toBe(`merged repeated headings in 0.9.0 (${PR})`)
    expect(readFileSync(file, "utf8")).toBe(dated.replace("- Older fix.", "- Older fix.\n- Oldest fix."))
  })

  it("lands a restore that names the entries it moved", () => {
    writeFileSync(file, `${dated}- Late fix.\n`)
    const shell = fakeShell((c) => (c.includes("--jq length") ? { out: "1" } : undefined))
    const landed = landChange({
      file,
      branch: "release/restore-0.9.0",
      change: (text) => restoreChange(text, dated, "0.9.0", "Unreleased"),
      done: "nothing",
      shell,
      log: (t) => logs.push(t),
    })
    expect(landed).toBe(`restored 0.9.0's notes to its tag; moved to Unreleased:\n- Late fix. (${PR})`)
    expect(readFileSync(file, "utf8")).toContain("## Unreleased\n\n### Fixed\n\n- Late fix.\n\n## 0.9.0")
    expect(calls.find((c) => c.startsWith("gh pr create"))).toContain("1 entry that missed 0.9.0 moved to Unreleased")
  })
})

describe("newestTag", () => {
  it("finds no tag before the first release", () => {
    expect(
      newestTag(
        fakeShell(() => undefined),
        "CHANGELOG.md",
      ),
    ).toBeUndefined()
  })

  it("reads the changelog at the highest tag", () => {
    const shell = fakeShell((c) =>
      c.startsWith("git tag")
        ? { out: "v0.9.0\nv0.10.0\nv0.2.1\n" }
        : c.startsWith("git show")
          ? { out: dated }
          : undefined,
    )
    expect(newestTag(shell, "CHANGELOG.md")).toEqual({ version: "0.10.0", text: dated })
  })
})
