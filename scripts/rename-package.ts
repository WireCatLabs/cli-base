// Moves a repository from @wirecat/cli-core to @wirecat/cli-base, in two passes that land at different
// times: `github` right after the GitHub repository is renamed (GitHub does not redirect a reusable
// workflow or action in a renamed repository), `npm` once the repository's upstream packages are on
// cli-base (an app ahead of its cli-messaging would install two framework copies). Tracked files only;
// the diff is left for review.
//
//   node <cli-base>/scripts/rename-package.ts --pass github [--dry-run]
//   node <cli-base>/scripts/rename-package.ts --pass npm --version 0.21.0 [--dry-run]
//   node <cli-base>/scripts/rename-package.ts --report
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { SKIPPED_FILES as OWNER_SKIPPED, type Rule, rewrite } from "./rename-owner.ts"

const END = String.raw`(?![\w-])`

export const RULES: Record<"github" | "npm", Rule[]> = {
  github: [
    { name: "repo path", pattern: new RegExp(`WireCatLabs/cli-core${END}`, "g"), replace: "WireCatLabs/cli-base" },
    {
      name: "escaped repo path",
      pattern: new RegExp(String.raw`WireCatLabs\\/cli-core${END}`, "g"),
      replace: String.raw`WireCatLabs\/cli-base`,
    },
    { name: "trusted publisher repo", pattern: /`cli-core`(?= \/ `[\w.-]+\.yml`)/g, replace: "`cli-base`" },
  ],
  npm: [
    { name: "package", pattern: new RegExp(`@wirecat/cli-core${END}`, "g"), replace: "@wirecat/cli-base" },
    {
      name: "escaped package",
      pattern: new RegExp(String.raw`@wirecat\\/cli-core${END}`, "g"),
      replace: String.raw`@wirecat\/cli-base`,
    },
    {
      name: "registry url",
      pattern: new RegExp(`@wirecat%2([fF])cli-core${END}`, "g"),
      replace: "@wirecat%2$1cli-base",
    },
    { name: "tarball", pattern: /(?<![\w.@-])wirecat-cli-core(?=-[\d*$])/g, replace: "wirecat-cli-base" },
    // The framework by name in prose and comments; after phase 5 a bare "cli-core" means the messenger layer.
    { name: "name", pattern: new RegExp(String.raw`(?<![\w/.@\\%-])cli-core${END}`, "g"), replace: "cli-base" },
  ],
}

// History stays as it was written, and so does the plan that explains both names.
export const SKIPPED_FILES = [
  ...OWNER_SKIPPED,
  /(^|\/)docs\/dev\/merge-shared-packages-plan\.md$/,
  /(^|\/)scripts\/rename-package(\.test)?\.ts$/,
]

const nextMinor = (version: string) => {
  const [major, minor] = version.split(".").map(Number)
  return `${major}.${(minor ?? 0) + 1}.0`
}

/** A renamed dependency keeps its kind: an exact pin becomes the new version, a range starts at it. */
export const repin = (path: string, text: string, version: string): string => {
  if (path.endsWith("package.json"))
    return text.replace(/("@wirecat\/cli-base":\s*")([^"]+)"/g, (_, key, spec: string) =>
      /^\d+\.\d+\.\d+$/.test(spec) ? `${key}${version}"` : `${key}>=${version} <${nextMinor(version)}"`,
    )
  if (path.endsWith("pnpm-workspace.yaml"))
    return text.replace(
      /(['"])@wirecat\/cli-base@[^'"]*\1/g,
      (_, quote) => `${quote}@wirecat/cli-base@${version}${quote}`,
    )
  return text
}

const trackedFiles = (): string[] =>
  execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\0")
    .filter((path) => path && !SKIPPED_FILES.some((skip) => skip.test(path)))

const readText = (path: string): string | undefined => {
  try {
    const bytes = readFileSync(path)
    return bytes.includes(0) ? undefined : bytes.toString("utf8")
  } catch {
    return undefined
  }
}

const runPass = (pass: "github" | "npm", dryRun: boolean, version: string | undefined) => {
  const total = new Map<string, number>()
  let files = 0
  for (const path of trackedFiles()) {
    const text = readText(path)
    if (text === undefined || !text.includes("cli-core")) continue
    const result = rewrite(text, RULES[pass])
    const out = pass === "npm" && version ? repin(path, result.text, version) : result.text
    if (out === text) continue
    files += 1
    for (const [name, n] of result.counts) total.set(name, (total.get(name) ?? 0) + n)
    if (!dryRun) writeFileSync(path, out)
  }
  console.log(`${dryRun ? "would change" : "changed"} ${files} files`)
  for (const [name, n] of total) console.log(`  ${name}: ${n}`)
}

const report = () => {
  for (const path of trackedFiles()) {
    const text = readText(path)
    if (text === undefined) continue
    text.split("\n").forEach((line, index) => {
      if (line.includes("cli-core")) console.log(`${path}:${index + 1}: ${line.trim().slice(0, 160)}`)
    })
  }
}

if (process.argv[1]?.endsWith("rename-package.ts")) {
  const args = process.argv.slice(2)
  const pass = args[args.indexOf("--pass") + 1]
  const version = args.includes("--version") ? args[args.indexOf("--version") + 1] : undefined
  if (args.includes("--report")) report()
  else if (pass === "github") runPass(pass, args.includes("--dry-run"), undefined)
  else if (pass === "npm" && version && /^\d+\.\d+\.\d+$/.test(version))
    runPass(pass, args.includes("--dry-run"), version)
  else {
    console.error(
      "usage: rename-package.ts --pass github [--dry-run] | --pass npm --version <x.y.z> [--dry-run] | --report",
    )
    process.exit(2)
  }
}
