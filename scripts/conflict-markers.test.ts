import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"

interface Step {
  name?: string
  run?: string
}

const workflow = parse(readFileSync(new URL("../.github/workflows/node-ci.yml", import.meta.url), "utf8"))
const script = (workflow.jobs.check.steps as Step[]).find((step) => step.name === "Merge conflict markers")?.run ?? ""

const ours = `${"<".repeat(7)} HEAD`
const base = `${"|".repeat(7)} parent of 1234567 (feat: x)`
const middle = "=".repeat(7)
const theirs = `${">".repeat(7)} 1234567 (feat: x)`

function scan(files: Record<string, string | Buffer>, ignore = "") {
  const repo = mkdtempSync(join(tmpdir(), "conflict-markers-"))
  const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" })
  git("init", "-q")
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), content)
  }
  git("add", ".")
  const result = spawnSync("bash", ["-eo", "pipefail", "-c", script], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, IGNORE: ignore },
  })
  return { status: result.status, out: result.stdout + result.stderr }
}

describe("node-ci merge conflict markers", () => {
  it("passes a tree without markers, including a longer underline and a marker inside a line", () => {
    const text = `# Title\n\nHeading\n${"=".repeat(8)}\n\nWrite \`${ours}\` to see it.\n${middle} trailing\n`
    expect(scan({ "README.md": text }).status).toBe(0)
  })

  it.each([
    ["ours", ours],
    ["base", base],
    ["separator", middle],
    ["theirs", theirs],
  ])("fails on the %s marker and names the file and line", (_, marker) => {
    const result = scan({ "docs/CHANGELOG.md": `# Changelog\n\n${marker}\n` })
    expect(result.status).toBe(1)
    expect(result.out).toContain("::error file=docs/CHANGELOG.md,line=3::")
  })

  it("reports every hit", () => {
    const result = scan({ "a.ts": `${ours}\nx\n${middle}\ny\n${theirs}\n` })
    expect(result.out.match(/::error /g)).toHaveLength(3)
  })

  it("skips binary files", () => {
    expect(scan({ "image.bin": Buffer.from(`${ours}\n\0\n`) }).status).toBe(0)
  })

  it("skips the paths the caller lists", () => {
    const files = { "test/fixtures/conflict.md": `${ours}\n`, "src/merge/sample.txt": `${theirs}\n` }
    expect(scan(files, "test/fixtures src/merge/*.txt").status).toBe(0)
    expect(scan(files, "test/fixtures").status).toBe(1)
  })
})
