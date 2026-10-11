import { describe, expect, it } from "vitest"
import { rewrite } from "./rename-owner.ts"
import { RULES, repin, SKIPPED_FILES } from "./rename-package.ts"

const github = (text: string) => rewrite(text, RULES.github).text
const npm = (text: string) => rewrite(text, RULES.npm).text

describe("github pass", () => {
  it.each([
    [
      "uses: WireCatLabs/cli-core/.github/workflows/node-ci.yml@4c78a803c460317fd40a38be6d1fb53278087741",
      "uses: WireCatLabs/cli-base/.github/workflows/node-ci.yml@4c78a803c460317fd40a38be6d1fb53278087741",
    ],
    ["https://github.com/WireCatLabs/cli-core#readme", "https://github.com/WireCatLabs/cli-base#readme"],
    ["git@github.com:WireCatLabs/cli-core.git", "git@github.com:WireCatLabs/cli-base.git"],
    ["github\\.com\\/WireCatLabs\\/cli-core\\/", "github\\.com\\/WireCatLabs\\/cli-base\\/"],
    ["`WireCatLabs` / `cli-core` / `release.yml`", "`WireCatLabs` / `cli-base` / `release.yml`"],
  ])("moves %s", (before, after) => {
    expect(github(before)).toBe(after)
  })

  it("leaves the package name for the npm pass", () => {
    expect(github('import { CliError } from "@wirecat/cli-core"')).toBe('import { CliError } from "@wirecat/cli-core"')
  })
})

describe("npm pass", () => {
  it.each([
    ['import { CliError } from "@wirecat/cli-core/commands"', 'import { CliError } from "@wirecat/cli-base/commands"'],
    ['"extends": ["@wirecat/cli-core/biome"]', '"extends": ["@wirecat/cli-base/biome"]'],
    [
      "  - node_modules/@wirecat/cli-core/config/lefthook.yml",
      "  - node_modules/@wirecat/cli-base/config/lefthook.yml",
    ],
    ["/@wirecat\\/(?:cli-messaging|cli-core)/", "/@wirecat\\/(?:cli-messaging|cli-base)/"],
    ["https://registry.npmjs.org/@wirecat%2fcli-core/0.21.0", "https://registry.npmjs.org/@wirecat%2fcli-base/0.21.0"],
    ["npm publish wirecat-cli-core-$VERSION.tgz", "npm publish wirecat-cli-base-$VERSION.tgz"],
    ["another copy of cli-core builds it", "another copy of cli-base builds it"],
  ])("moves %s", (before, after) => {
    expect(npm(before)).toBe(after)
  })

  it.each(["WireCatLabs/cli-core", "cli-core-smoke", "/tmp/cli-core-test", "@wirecat/cli-core-extra"])(
    "leaves %s",
    (text) => {
      expect(npm(text)).toBe(text)
    },
  )
})

describe("repin", () => {
  it("gives an exact pin the new version and a range a new floor", () => {
    const text =
      '{ "devDependencies": { "@wirecat/cli-base": "0.20.0" }, "peerDependencies": { "@wirecat/cli-base": ">=0.20.0 <0.21.0" } }'
    expect(repin("package.json", text, "0.21.0")).toBe(
      '{ "devDependencies": { "@wirecat/cli-base": "0.21.0" }, "peerDependencies": { "@wirecat/cli-base": ">=0.21.0 <0.22.0" } }',
    )
  })

  it("lets the fresh version past pnpm's minimum release age", () => {
    expect(repin("pnpm-workspace.yaml", "  - '@wirecat/cli-base@0.19.0 || 0.20.0'", "0.21.0")).toBe(
      "  - '@wirecat/cli-base@0.21.0'",
    )
  })
})

it.each(["CHANGELOG.md", "pnpm-lock.yaml", "journal/2026-10-11.md", "docs/dev/merge-shared-packages-plan.md"])(
  "skips %s",
  (path) => {
    expect(SKIPPED_FILES.some((skip) => skip.test(path))).toBe(true)
  },
)
