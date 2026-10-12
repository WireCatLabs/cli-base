import { describe, expect, it } from "vitest"
import { rewrite } from "./rename-owner.ts"
import { type Names, repin, rules, SKIPPED_FILES } from "./rename-package.ts"

const base: Names = { from: "cli-core", to: "cli-base" }
const core: Names = { from: "cli-messaging", to: "cli-core", suffixes: ["sqlite", "onnx"] }
const pass = (names: Names, kind: "github" | "npm") => (text: string) => rewrite(text, rules(names)[kind]).text

describe("cli-core to cli-base", () => {
  it.each([
    [
      "uses: WireCatLabs/cli-core/.github/workflows/node-ci.yml@4c78a803c460317fd40a38be6d1fb53278087741",
      "uses: WireCatLabs/cli-base/.github/workflows/node-ci.yml@4c78a803c460317fd40a38be6d1fb53278087741",
    ],
    ["https://github.com/WireCatLabs/cli-core#readme", "https://github.com/WireCatLabs/cli-base#readme"],
    ["github\\.com\\/WireCatLabs\\/cli-core\\/", "github\\.com\\/WireCatLabs\\/cli-base\\/"],
    ["`WireCatLabs` / `cli-core` / `release.yml`", "`WireCatLabs` / `cli-base` / `release.yml`"],
  ])("github moves %s", (before, after) => {
    expect(pass(base, "github")(before)).toBe(after)
  })

  it.each([
    ['import { CliError } from "@wirecat/cli-core/commands"', 'import { CliError } from "@wirecat/cli-base/commands"'],
    [
      "  - node_modules/@wirecat/cli-core/config/lefthook.yml",
      "  - node_modules/@wirecat/cli-base/config/lefthook.yml",
    ],
    ["/@wirecat\\/(?:cli-messaging|cli-core)/", "/@wirecat\\/(?:cli-messaging|cli-base)/"],
    ["https://registry.npmjs.org/@wirecat%2fcli-core/0.21.0", "https://registry.npmjs.org/@wirecat%2fcli-base/0.21.0"],
    ["npm publish wirecat-cli-core-$VERSION.tgz", "npm publish wirecat-cli-base-$VERSION.tgz"],
    ["another copy of cli-core builds it", "another copy of cli-base builds it"],
  ])("npm moves %s", (before, after) => {
    expect(pass(base, "npm")(before)).toBe(after)
  })

  it.each(["WireCatLabs/cli-core", "cli-core-smoke", "/tmp/cli-core-test", "@wirecat/cli-core-extra"])(
    "npm leaves %s",
    (text) => {
      expect(pass(base, "npm")(text)).toBe(text)
    },
  )
})

describe("cli-messaging to cli-core, with its add-ons", () => {
  it.each([
    [
      '"url": "git+https://github.com/WireCatLabs/cli-messaging.git"',
      '"url": "git+https://github.com/WireCatLabs/cli-core.git"',
    ],
    ["gh issue view 849 -R WireCatLabs/cli-messaging", "gh issue view 849 -R WireCatLabs/cli-core"],
  ])("github moves %s", (before, after) => {
    expect(pass(core, "github")(before)).toBe(after)
  })

  it.each([
    ['from "@wirecat/cli-messaging/meetings/testing"', 'from "@wirecat/cli-core/meetings/testing"'],
    ['"@wirecat/cli-messaging-sqlite": "1.0.1"', '"@wirecat/cli-core-sqlite": "1.0.1"'],
    ['"name": "@wirecat/cli-messaging-onnx"', '"name": "@wirecat/cli-core-onnx"'],
    ["npm publish wirecat-cli-messaging-$VERSION.tgz", "npm publish wirecat-cli-core-$VERSION.tgz"],
    ["npm publish wirecat-cli-messaging-sqlite-1.0.2.tgz", "npm publish wirecat-cli-core-sqlite-1.0.2.tgz"],
    ["the cli-messaging store and the cli-messaging-onnx models", "the cli-core store and the cli-core-onnx models"],
  ])("npm moves %s", (before, after) => {
    expect(pass(core, "npm")(before)).toBe(after)
  })

  it.each(["cli-messaging-parity max", "@wirecat/cli-messaging-extra", "WireCatLabs/cli-messaging"])(
    "npm leaves %s",
    (text) => {
      expect(pass(core, "npm")(text)).toBe(text)
    },
  )

  it("leaves cli-base alone", () => {
    expect(pass(core, "npm")('import { CliError } from "@wirecat/cli-base"')).toBe(
      'import { CliError } from "@wirecat/cli-base"',
    )
  })
})

describe("repin", () => {
  it("gives an exact pin the new version and a range a new floor", () => {
    const text =
      '{ "dependencies": { "@wirecat/cli-core": "0.255.0" }, "peerDependencies": { "@wirecat/cli-core": ">=0.255.0 <0.256.0" } }'
    expect(repin("package.json", text, "cli-core", "0.256.0")).toBe(
      '{ "dependencies": { "@wirecat/cli-core": "0.256.0" }, "peerDependencies": { "@wirecat/cli-core": ">=0.256.0 <0.257.0" } }',
    )
  })

  it("lets the fresh version past pnpm's minimum release age", () => {
    expect(repin("pnpm-workspace.yaml", "  - '@wirecat/cli-core@0.218.0 || 0.255.0'", "cli-core", "0.256.0")).toBe(
      "  - '@wirecat/cli-core@0.256.0'",
    )
  })
})

it.each([
  "CHANGELOG.md",
  "pnpm-lock.yaml",
  "journal/2026-10-11.md",
  "docs/dev/merge-shared-packages-plan.md",
  "translations/tg/changelog.ru.md",
  "docs/reviews/2026-10-08-guide.md",
  "contracts/previous/package.json",
])("skips %s", (path) => {
  expect(SKIPPED_FILES.some((skip) => skip.test(path))).toBe(true)
})
