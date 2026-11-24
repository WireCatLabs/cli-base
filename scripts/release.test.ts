import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { build } from "esbuild"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const root = join(import.meta.dirname, "..")
const dirs: string[] = []
let dist = ""

// bin/release runs cli-dev from dist/, and the test shards do not build: the dev bin is bundled from src/ instead,
// inside the worktree so its packages resolve from node_modules.
beforeAll(async () => {
  mkdirSync(join(root, "node_modules/.cache"), { recursive: true })
  dist = mkdtempSync(join(root, "node_modules/.cache/release-dist-"))
  dirs.push(dist)
  await build({
    entryPoints: [join(root, "src/dev/bin.ts")],
    outfile: join(dist, "dev/bin.js"),
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

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" })

const stub = (dir: string, name: string, body: string) => {
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`)
  chmodSync(join(dir, name), 0o755)
}

type Repo = { version: string; published: string[]; changelog: string; fragment?: string }

// gh refuses to open the release pull request, which stops the run right after the release branch is pushed, before
// anything could publish.
const release = ({ version, published, changelog, fragment }: Repo) => {
  const work = mkdtempSync(join(tmpdir(), "release-"))
  dirs.push(work)
  const origin = join(work, "origin.git")
  const repo = join(work, "repo")
  const stubs = join(work, "stubs")
  mkdirSync(stubs)
  git(work, "init", "-q", "--bare", "-b", "main", origin)
  git(work, "clone", "-q", origin, repo)
  for (const file of ["bin/release", "scripts/next-version.mjs", "config/wirecat/release-lock.sh"]) {
    mkdirSync(join(repo, file, ".."), { recursive: true })
    cpSync(join(root, file), join(repo, file))
  }
  cpSync(join(root, "config/wirecat/release-lock-info.mjs"), join(repo, "config/wirecat/release-lock-info.mjs"))
  symlinkSync(dist, join(repo, "dist"))
  writeFileSync(join(repo, ".gitignore"), "dist\n")
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ name: "@wirecat/cli-base", version }, null, 2)}\n`)
  writeFileSync(join(repo, "CHANGELOG.md"), changelog)
  if (fragment) {
    mkdirSync(join(repo, "changes"))
    writeFileSync(join(repo, "changes/feat-x.md"), fragment)
  }
  git(repo, "add", "-A")
  git(repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init")
  for (const tag of published) git(repo, "tag", `v${tag}`)
  git(repo, "push", "-q", "--tags", "origin", "main")

  const latest = published.at(-1) ?? ""
  const views = published.map((one) => `"view @wirecat/cli-base@${one} version "*`).join("|")
  stub(stubs, "pnpm", '[ "$1" = build ] && exit 0\nexit 1')
  stub(
    stubs,
    "npm",
    [
      'case "$*" in',
      `  *" versions "*) echo '${JSON.stringify(published)}' ;;`,
      `  "view @wirecat/cli-base version "*) echo ${latest} ;;`,
      ...(views ? [`  ${views}) echo yes ;;`] : []),
      "  *) exit 1 ;;",
      "esac",
    ].join("\n"),
  )
  stub(stubs, "gh", "exit 1")
  const run = spawnSync("sh", ["bin/release"], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubs}:${process.env.PATH}`,
      XDG_RUNTIME_DIR: work,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  })
  const branches = git(origin, "branch", "--format=%(refname:short)").split("\n").filter(Boolean)
  const show = (branch: string, file: string) => git(origin, "show", `${branch}:${file}`)
  const files = (branch: string) => git(origin, "ls-tree", "-r", "--name-only", branch)
  return { run, branches, show, files }
}

const PUBLISHED = "# Changelog\n\n## 0.131.0 — 22.11.2026\n\n### Fixed\n\n- **Old.** Shipped in 0.131.0.\n"
const above = (section: string) => PUBLISHED.replace("## 0.131.0", `${section}\n\n## 0.131.0`)

// bin/release takes the release lock with flock, which macOS does not ship.
// Each run starts node several times; a loaded machine takes seconds for each.
describe.skipIf(spawnSync("sh", ["-c", "command -v flock"]).status !== 0)("bin/release", { timeout: 60_000 }, () => {
  it("gives fragments a new section and leaves the published one as npm has it", () => {
    const { run, branches, show, files } = release({
      version: "0.131.0",
      published: ["0.131.0"],
      changelog: PUBLISHED,
      fragment: "### Fixed\n\n- **New.** Merged after 0.131.0.\n",
    })
    expect(run.stdout).toContain("0.131.0 is already on npm — publishing 0.131.1 instead")
    expect(branches).toContain("release/0.131.1")
    expect(JSON.parse(show("release/0.131.1", "package.json")).version).toBe("0.131.1")
    const log = show("release/0.131.1", "CHANGELOG.md")
    expect(log).toMatch(/## 0\.131\.1 — [\d.]+\n\n### Fixed\n\n- \*\*New\.\*\*/)
    expect(log).toContain("## 0.131.0 — 22.11.2026\n\n### Fixed\n\n- **Old.** Shipped in 0.131.0.\n")
    expect(log.split("\n## 0.131.0")[0]).not.toContain("Old")
    expect(files("release/0.131.1")).not.toContain("changes/feat-x.md")
  })

  it("follows a published 1.0.0 with a patch when only a fix is unreleased", () => {
    const { run, branches, show } = release({
      version: "1.0.0",
      published: ["0.131.0", "1.0.0"],
      changelog: above(
        "## Unreleased\n\n### Fixed\n\n- **Fix.** After 1.0.0.\n\n## 1.0.0 — 23.11.2026\n\n### Added\n\n- **One.** A.",
      ),
    })
    expect(run.stdout).toContain("1.0.0 is already on npm — publishing 1.0.1 instead")
    expect(branches).toContain("release/1.0.1")
    expect(show("release/1.0.1", "CHANGELOG.md")).toMatch(/## 1\.0\.1 — [\d.]+\n\n### Fixed\n\n- \*\*Fix\.\*\*/)
  })

  it("refuses an empty Unreleased section on a published version", () => {
    const { run, branches } = release({ version: "0.131.0", published: ["0.131.0"], changelog: above("## Unreleased") })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain("0.131.0 is already on npm and nothing is unreleased")
    expect(branches).toEqual(["main"])
  })

  it("raises to the level the fragments need: an Added is a minor", () => {
    const { run, branches, show } = release({
      version: "0.131.1",
      published: ["0.131.0", "0.131.1"],
      changelog: above("## 0.131.1 — 23.11.2026\n\n### Fixed\n\n- **One.** A fix."),
      fragment: "### Added\n\n- **Pages.** Pages are written.\n",
    })
    expect(run.stdout).toContain("0.131.1 is already on npm — publishing 0.132.0 instead")
    expect(show("release/0.132.0", "CHANGELOG.md")).toMatch(/## 0\.132\.0 — [\d.]+\n\n### Added\n\n- \*\*Pages\.\*\*/)
    expect(branches).not.toContain("release/0.131.2")
  })

  it("refuses a published version with nothing unreleased instead of renaming its section", () => {
    const { run, branches } = release({ version: "0.131.0", published: ["0.131.0"], changelog: PUBLISHED })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain("0.131.0 is already on npm and nothing is unreleased")
    expect(branches).toEqual(["main"])
  })

  it("does not collect fragments into a published pre-release", () => {
    const { run, branches } = release({
      version: "1.0.0-rc.0",
      published: ["0.131.0", "1.0.0-rc.0"],
      changelog: above("## 1.0.0-rc.0 — 23.11.2026\n\n### Added\n\n- **Rc.** A."),
      fragment: "### Fixed\n\n- **New.** After the rc.\n",
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain("1.0.0-rc.0 is already on npm — raise the version first")
    expect(branches).toEqual(["main"])
  })

  it("stops a major the fragments need before anything lands, without --major", () => {
    const { run, branches } = release({
      version: "1.0.0",
      published: ["0.131.0", "1.0.0"],
      changelog: above("## 1.0.0 — 23.11.2026\n\n### Added\n\n- **One.** A."),
      fragment: "### Removed\n\n- **Gone.** A stable name is removed.\n",
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain("2.0.0 raises the major version over npm's 1.0.0")
    expect(branches).toEqual(["main"])
  })
})
