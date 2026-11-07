import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  conformanceCommand,
  conformanceSection,
  cronProblems,
  parityProblems,
  releasePrProblems,
  rulesetProblems,
  takenMinutes,
} from "./conformance.js"
import type { Shell } from "./land.js"

const answering = (answer: (call: string) => { ok?: boolean; out?: string }): Shell => ({
  run: (command, args) => {
    const given = answer([command, ...args].join(" "))
    return { ok: given.ok ?? true, out: given.out ?? "" }
  },
  sleep: () => {},
})

const ioIn = (cwd: string) => {
  const out: string[] = []
  const err: string[] = []
  return {
    io: {
      cwd,
      now: () => new Date("2026-11-07T10:00:00Z"),
      out: (t: string) => out.push(t),
      err: (t: string) => err.push(t),
    },
    out,
    err,
  }
}

const git = (cwd: string, ...args: string[]) => {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (run.status !== 0) throw new Error(run.stderr)
  return run.stdout.trim()
}

const repoWith = (files: Record<string, string>) => {
  const cwd = mkdtempSync(join(tmpdir(), "cli-dev-conformance-"))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(cwd, path, ".."), { recursive: true })
    writeFileSync(join(cwd, path), text)
  }
  git(cwd, "init", "-q")
  git(cwd, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "add", "-A")
  git(cwd, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "init")
  return cwd
}

describe("release pull request", () => {
  it("needs a non-empty Conformance section only when the version changes", () => {
    expect(releasePrProblems("no section", "0.3.0", "0.3.0")).toEqual([])
    expect(releasePrProblems("## Testing\n\nran", "0.3.0", "0.4.0")[0]).toContain('no "## Conformance" section')
    expect(releasePrProblems("## Conformance\n\n## Testing\nran", "0.3.0", "0.4.0")[0]).toContain("empty")
    expect(releasePrProblems("## Why\n\nx\n\n### Conformance\n\n- live: pass\n", "0.3.0", "0.4.0")).toEqual([])
  })

  it("reads a section up to the next heading of its level, keeping deeper ones", () => {
    expect(conformanceSection("## Conformance\n### Live\nok\n## Next\nx")).toBe("### Live\nok")
  })

  it("compares package.json with the base commit's", () => {
    const cwd = repoWith({ "package.json": '{"version":"0.3.0"}\n', "body.md": "## Testing\n" })
    const base = git(cwd, "rev-parse", "HEAD")
    writeFileSync(join(cwd, "package.json"), '{"version":"0.4.0"}\n')
    const { io, err } = ioIn(cwd)
    expect(conformanceCommand("release-pr", ["--base", base, "--body", "body.md"], io)).toBe(1)
    expect(err.join("")).toContain("0.3.0 → 0.4.0")
    writeFileSync(join(cwd, "body.md"), "## Conformance\n\n- release:check passed\n")
    expect(conformanceCommand("release-pr", ["--base", base, "--body", join(cwd, "body.md")], ioIn(cwd).io)).toBe(0)
  })
})

describe("live check record", () => {
  const files = { "package.json": '{"version":"0.4.0"}\n', "src/index.ts": "export {}\n", "docs/dev/.keep": "" }

  it("records the commit that was checked, and bin/release's check accepts that code", () => {
    const cwd = repoWith(files)
    const { io, out } = ioIn(cwd)
    expect(conformanceCommand("live", ["record", "--script", "bin/x-live"], io)).toBe(0)
    expect(out[0]).toBe(`0.4.0 ${git(cwd, "rev-parse", "HEAD")} 2026-11-07 bin/x-live`)
    expect(readFileSync(join(cwd, "docs/dev/live-checks.txt"), "utf8")).toContain(out[0])
    expect(conformanceCommand("live", ["check"], ioIn(cwd).io)).toBe(0)
  })

  it("refuses a version with no record, and code changed since its record", () => {
    const cwd = repoWith(files)
    const none = ioIn(cwd)
    expect(conformanceCommand("live", ["check"], none.io)).toBe(1)
    expect(none.err[0]).toContain("no live check recorded for 0.4.0")
    conformanceCommand("live", ["record", "--script", "bin/x-live"], ioIn(cwd).io)
    writeFileSync(join(cwd, "src/index.ts"), "export const changed = 1\n")
    git(cwd, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qam", "change")
    const changed = ioIn(cwd)
    expect(conformanceCommand("live", ["check"], changed.io)).toBe(1)
    expect(changed.err[0]).toContain("changed since 0.4.0's live check")
  })

  it("will not record uncommitted code", () => {
    const cwd = repoWith(files)
    writeFileSync(join(cwd, "src/index.ts"), "export const dirty = 1\n")
    const { io, err } = ioIn(cwd)
    expect(conformanceCommand("live", ["record", "--script", "bin/x-live"], io)).toBe(1)
    expect(err[0]).toContain("commit src")
  })
})

describe("repository setup", () => {
  const rules = (...types: string[]) => JSON.stringify(types.map((type) => ({ type })))

  it("passes a ruleset with the four rules new-cli.md names, and names what is missing", () => {
    const all = rules("deletion", "non_fast_forward", "pull_request", "required_status_checks")
    expect(
      rulesetProblems(
        answering(() => ({ out: all })),
        "o/r",
      ),
    ).toEqual({ problems: [] })
    expect(
      rulesetProblems(
        answering(() => ({ out: "[]" })),
        "o/r",
      ).problems[0],
    ).toContain("lacks deletion")
    expect(
      rulesetProblems(
        answering(() => ({ ok: false, out: "gh: Not Found (HTTP 404)" })),
        "o/r",
      ).problems[0],
    ).toContain("404")
  })

  it("skips the ruleset without a login or a network, and says why", () => {
    const login = answering(() => ({ ok: false, out: "To get started with GitHub CLI, please run:  gh auth login" }))
    expect(rulesetProblems(login, "o/r")).toMatchObject({ problems: [], skipped: expect.stringContaining("signed in") })
    const offline = answering(() => ({ ok: false, out: "error connecting to api.github.com" }))
    expect(rulesetProblems(offline, "o/r")).toMatchObject({ problems: [], skipped: expect.stringContaining("reached") })
  })

  it("skips only GitHub's free-plan 403 for a private repository; any other 403 fails", () => {
    const freePlan = answering(() => ({
      ok: false,
      out: '{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.","status":"403"}gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)',
    }))
    expect(rulesetProblems(freePlan, "o/r")).toMatchObject({
      problems: [],
      skipped: expect.stringContaining("free plan"),
    })
    const forbidden = answering(() => ({ ok: false, out: "gh: Resource not accessible by integration (HTTP 403)" }))
    expect(rulesetProblems(forbidden, "o/r").problems[0]).toContain("Resource not accessible")
  })

  it("refuses the template's monthly minute in a CLI made from it, and accepts the template's own", () => {
    const taken = takenMinutes("| UTC | Repository |\n|---|---|\n| 02:17 | cli-base |\n| 03:02 | cli-template |\n")
    const workflow = (cron: string) => `on:\n  schedule:\n    - cron: "${cron}"\n`
    expect(cronProblems(workflow("2 3 1 * *"), "cli-template", taken)).toEqual([])
    expect(cronProblems(workflow("2 3 1 * *"), "b24-cli", taken)[0]).toContain("cli-template's minute")
    expect(cronProblems(workflow("44 2 1 * *"), "b24-cli", taken)).toEqual([])
    expect(cronProblems(workflow("44 2 15 * *"), "b24-cli", taken)[0]).toContain("day 15")
    expect(cronProblems(undefined, "b24-cli", taken)[0]).toContain("missing")
  })

  it("reads the taken minutes from the shipped WC-CI-9 page", () => {
    const page = readFileSync(join(import.meta.dirname, "../../docs/standards/ci.md"), "utf8")
    expect(takenMinutes(page).get("03:02")).toBe("cli-template")
  })

  it("finds a CLI in cli-base's parity groups or the repository's own", () => {
    expect(parityProblems("tg", undefined)).toEqual([])
    expect(parityProblems("b24", undefined)).toEqual([])
    expect(parityProblems("clidev", undefined)[0]).toContain("no parity group")
    const own = [{ name: "template", members: ["clidev", "tg"], covers: ["commands"], differences: [] }]
    expect(parityProblems("clidev", own)).toEqual([])
  })
})
