import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { build } from "esbuild"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { parse } from "yaml"

const root = join(import.meta.dirname, "..")
const dirs: string[] = []
let cliDev = ""

type Step = { name?: string; run?: string }
const workflow = parse(readFileSync(join(root, ".github/workflows/release-start.yml"), "utf8")) as {
  jobs: { prepare: { steps: Step[] } }
}
const settle = workflow.jobs.prepare.steps.find((step) => step.name === "settle the version")?.run ?? ""

// The test shards do not build: the dev bin is bundled from src/ instead, inside the worktree so its packages resolve.
beforeAll(async () => {
  mkdirSync(join(root, "node_modules/.cache"), { recursive: true })
  const dist = mkdtempSync(join(root, "node_modules/.cache/release-start-dist-"))
  dirs.push(dist)
  cliDev = join(dist, "bin.js")
  await build({
    entryPoints: [join(root, "src/dev/bin.ts")],
    outfile: cliDev,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  })
}, 60_000)
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, encoding: "utf8" })

type Repo = {
  version: string
  published: string[]
  changelog: string
  fragment?: string
  major?: boolean
  unreleased?: string
  versionTs?: boolean
}

// The published versions are tagged on a first commit, without the Unreleased section, and the changelog under test
// lands on a second, as on main.
const start = ({
  version,
  published,
  changelog,
  fragment,
  major = false,
  unreleased = "Unreleased",
  versionTs,
}: Repo) => {
  const work = mkdtempSync(join(tmpdir(), "release-start-"))
  dirs.push(work)
  const origin = join(work, "origin.git")
  const repo = join(work, "repo")
  const stubs = join(work, "stubs")
  mkdirSync(stubs)
  git(work, "init", "-q", "--bare", "-b", "main", origin)
  git(work, "clone", "-q", origin, repo)
  const tagged = published.at(-1) ?? version
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ name: "@wirecat/x", version: tagged }, null, 2)}\n`)
  writeFileSync(
    join(repo, "CHANGELOG.md"),
    changelog.replace(new RegExp(`^## ${unreleased}\n[\\s\\S]*?(?=^## )`, "m"), ""),
  )
  if (versionTs) {
    mkdirSync(join(repo, "src"))
    writeFileSync(join(repo, "src/version.ts"), `export const VERSION = "${version}"\n`)
  }
  git(repo, "add", "-A")
  git(repo, "commit", "-q", "-m", "init")
  for (const tag of published) git(repo, "tag", `v${tag}`)
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ name: "@wirecat/x", version }, null, 2)}\n`)
  writeFileSync(join(repo, "CHANGELOG.md"), changelog)
  if (fragment) {
    mkdirSync(join(repo, "changes"))
    writeFileSync(join(repo, "changes/feat-x.md"), fragment)
  }
  git(repo, "add", "-A")
  git(repo, "commit", "-q", "--allow-empty", "-m", "next")
  git(repo, "push", "-q", "--tags", "origin", "main")

  const latest = published.at(-1) ?? ""
  const views = published.map((one) => `"view @wirecat/x@${one} version "*`).join("|")
  writeFileSync(
    join(stubs, "npm"),
    [
      "#!/bin/sh",
      'case "$*" in',
      `  *" versions "*) echo '${JSON.stringify(published)}' ;;`,
      `  "view @wirecat/x version "*) echo ${latest} ;;`,
      ...(views ? [`  ${views}) echo yes ;;`] : []),
      "  *) exit 1 ;;",
      "esac",
      "",
    ].join("\n"),
  )
  chmodSync(join(stubs, "npm"), 0o755)
  const output = join(work, "output")
  writeFileSync(output, "")
  const run = spawnSync("sh", ["-c", settle], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubs}:${process.env.PATH}`,
      CLI_DEV: `node ${cliDev}`,
      UNRELEASED: unreleased,
      AFTER_RAISE: 'echo "$VERSION" >> raised.log',
      CHECK: "",
      MAJOR: String(major),
      GITHUB_OUTPUT: output,
    },
  })
  const read = (file: string) => (existsSync(join(repo, file)) ? readFileSync(join(repo, file), "utf8") : "")
  return { run, read, output: readFileSync(output, "utf8") }
}

const PUBLISHED = "# Changelog\n\n## 0.131.0 — 22.11.2026\n\n### Fixed\n\n- **Old.** Shipped in 0.131.0.\n"
const above = (section: string) => PUBLISHED.replace("## 0.131.0", `${section}\n\n## 0.131.0`)

// Each run starts node several times; a loaded machine takes seconds for each.
describe("release-start.yml settles the version as bin/release does", { timeout: 60_000 }, () => {
  it("finds the step's script", () => {
    expect(settle).toContain("changelog level --next")
  })

  it("gives fragments a new section and leaves the published one as npm has it", () => {
    const { run, read, output } = start({
      version: "0.131.0",
      published: ["0.131.0"],
      changelog: PUBLISHED,
      fragment: "### Fixed\n\n- **New.** Merged after 0.131.0.\n",
    })
    expect(run.status).toBe(0)
    expect(output).toContain("version=0.131.1\n")
    expect(JSON.parse(read("package.json")).version).toBe("0.131.1")
    const log = read("CHANGELOG.md")
    expect(log).toMatch(/## 0\.131\.1 — [\d.]+\n\n### Fixed\n\n- \*\*New\.\*\*/)
    expect(log).toContain("## 0.131.0 — 22.11.2026\n\n### Fixed\n\n- **Old.** Shipped in 0.131.0.\n")
    expect(log.split("\n## 0.131.0")[0]).not.toContain("Old")
    expect(read("changes/feat-x.md")).toBe("")
  })

  it("follows a published 1.0.0 with a patch when only a fix is unreleased", () => {
    const { run, read, output } = start({
      version: "1.0.0",
      published: ["0.131.0", "1.0.0"],
      changelog: above(
        "## Unreleased\n\n### Fixed\n\n- **Fix.** After 1.0.0.\n\n## 1.0.0 — 23.11.2026\n\n### Added\n\n- **One.** A.",
      ),
    })
    expect(run.status).toBe(0)
    expect(output).toContain("version=1.0.1\n")
    expect(read("CHANGELOG.md")).toMatch(/## 1\.0\.1 — [\d.]+\n\n### Fixed\n\n- \*\*Fix\.\*\*/)
  })

  it("follows a published 1.0.0 with a minor when a fragment adds something", () => {
    const { run, read, output } = start({
      version: "1.0.0",
      published: ["0.131.0", "1.0.0"],
      changelog: above("## 1.0.0 — 23.11.2026\n\n### Added\n\n- **One.** A."),
      fragment: "### Added\n\n- **Pages.** Pages are written.\n",
    })
    expect(run.status).toBe(0)
    expect(output).toContain("version=1.1.0\n")
    expect(read("CHANGELOG.md")).toMatch(/## 1\.1\.0 — [\d.]+\n\n### Added\n\n- \*\*Pages\.\*\*/)
    expect(read("CHANGELOG.md")).not.toContain("## 1.0.1")
  })

  it("raises src/version.ts under a custom title and runs after-raise once, with the version that ships", () => {
    const { run, read, output } = start({
      version: "1.0.0",
      published: ["0.131.0", "1.0.0"],
      changelog: above("## Next\n\n### Added\n\n- **Two.** B.\n\n## 1.0.0 — 23.11.2026\n\n### Added\n\n- **One.** A."),
      unreleased: "Next",
      versionTs: true,
    })
    expect(run.status).toBe(0)
    expect(output).toContain("version=1.1.0\n")
    expect(read("src/version.ts")).toBe('export const VERSION = "1.1.0"\n')
    expect(read("raised.log")).toBe("1.1.0\n")
    expect(read("CHANGELOG.md")).toMatch(/## 1\.1\.0 — [\d.]+\n\n### Added\n\n- \*\*Two\.\*\*/)
  })

  it("refuses an empty Unreleased section on a published version", () => {
    const { run, read } = start({ version: "0.131.0", published: ["0.131.0"], changelog: above("## Unreleased") })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain("0.131.0 is already on npm and nothing is unreleased")
    expect(JSON.parse(read("package.json")).version).toBe("0.131.0")
  })

  it("refuses a published version with nothing unreleased instead of renaming its section", () => {
    const { run, read } = start({ version: "0.131.0", published: ["0.131.0"], changelog: PUBLISHED })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain("0.131.0 is already on npm and nothing is unreleased")
    expect(read("CHANGELOG.md")).toBe(PUBLISHED)
  })

  it("stops a major the fragments need unless major is allowed", () => {
    const repo = {
      version: "1.0.0",
      published: ["0.131.0", "1.0.0"],
      changelog: above("## 1.0.0 — 23.11.2026\n\n### Added\n\n- **One.** A."),
      fragment: "### Removed\n\n- **Gone.** A stable name is removed.\n",
    }
    const refused = start(repo)
    expect(refused.run.status).toBe(1)
    expect(refused.run.stdout).toContain("2.0.0 raises the major version over npm's 1.0.0")
    const allowed = start({ ...repo, major: true })
    expect(allowed.run.status).toBe(0)
    expect(allowed.output).toContain("version=2.0.0\n")
  })
})
