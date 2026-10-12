// Moves a repository from one @wirecat package name to another, in two passes that land at different
// times: `github` right after the GitHub repository is renamed (GitHub does not redirect a reusable
// workflow or action in a renamed repository), `npm` once the repository's upstream packages are on the
// new name (an app ahead of its dependencies would install two copies). Tracked files only; the diff is
// left for review. Both names are required: after phase 5 `cli-core` names the messenger package, so a
// default would rewrite the wrong thing.
//
//   node <cli-base>/scripts/rename-package.ts --from cli-core --to cli-base --pass github [--dry-run]
//   node <cli-base>/scripts/rename-package.ts --from cli-messaging --to cli-core --suffixes sqlite,onnx \
//     --pass npm --version 0.256.0 [--dry-run]
//   node <cli-base>/scripts/rename-package.ts --from cli-messaging --report
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { SKIPPED_FILES as OWNER_SKIPPED, type Rule, rewrite } from "./rename-owner.ts"

const END = String.raw`(?![\w-])`
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export interface Names {
  from: string
  to: string
  /** Packages named `<from>-<suffix>` that move to `<to>-<suffix>`, as cli-messaging's native add-ons. */
  suffixes?: string[]
}

export const rules = ({ from, to, suffixes = [] }: Names): Record<"github" | "npm", Rule[]> => {
  const f = literal(from)
  const add = suffixes.length ? `-(?:${suffixes.map(literal).join("|")})` : ""
  return {
    github: [
      { name: "repo path", pattern: new RegExp(`WireCatLabs/${f}${END}`, "g"), replace: `WireCatLabs/${to}` },
      {
        name: "escaped repo path",
        pattern: new RegExp(String.raw`WireCatLabs\\/${f}${END}`, "g"),
        replace: String.raw`WireCatLabs\/${to}`,
      },
      {
        name: "trusted publisher repo",
        pattern: new RegExp(`\`${f}\`(?= / \`[\\w.-]+\\.yml\`)`, "g"),
        replace: `\`${to}\``,
      },
    ],
    npm: [
      ...(add
        ? [
            {
              name: "add-on package",
              pattern: new RegExp(`@wirecat/${f}(${add})${END}`, "g"),
              replace: `@wirecat/${to}$1`,
            },
          ]
        : []),
      { name: "package", pattern: new RegExp(`@wirecat/${f}${END}`, "g"), replace: `@wirecat/${to}` },
      {
        name: "escaped package",
        pattern: new RegExp(String.raw`@wirecat\\/${f}${END}`, "g"),
        replace: String.raw`@wirecat\/${to}`,
      },
      { name: "registry url", pattern: new RegExp(`@wirecat%2([fF])${f}${END}`, "g"), replace: `@wirecat%2$1${to}` },
      {
        name: "tarball",
        pattern: new RegExp(String.raw`(?<![\w.@-])wirecat-${f}(${add || "(?!)"})?(?=-[\d*$])`, "g"),
        replace: `wirecat-${to}$1`,
      },
      // The package by name in prose and comments, so a bare old name does not point at the wrong package.
      ...(add
        ? [
            {
              name: "add-on name",
              pattern: new RegExp(String.raw`(?<![\w/.@\\%-])${f}(${add})${END}`, "g"),
              replace: `${to}$1`,
            },
          ]
        : []),
      { name: "name", pattern: new RegExp(String.raw`(?<![\w/.@\\%-])${f}${END}`, "g"), replace: to },
    ],
  }
}

// History stays as it was written, and so does the plan that explains the names.
export const SKIPPED_FILES = [
  ...OWNER_SKIPPED,
  /(^|\/)docs\/dev\/merge-shared-packages-plan\.md$/,
  /(^|\/)scripts\/rename-package(\.test)?\.ts$/,
  /(^|\/)(reviews|agent-evals)\//,
  /(^|\/)changelog(\.[a-z]{2})?\.md$/,
  /(^|\/)contracts\/previous\//,
]

const nextMinor = (version: string) => {
  const [major, minor] = version.split(".").map(Number)
  return `${major}.${(minor ?? 0) + 1}.0`
}

/** A renamed dependency keeps its kind: an exact pin becomes the new version, a range starts at it. */
export const repin = (path: string, text: string, to: string, version: string): string => {
  const name = literal(`@wirecat/${to}`)
  if (path.endsWith("package.json"))
    return text.replace(new RegExp(`("${name}":\\s*")([^"]+)"`, "g"), (_, key, spec: string) =>
      /^\d+\.\d+\.\d+$/.test(spec) ? `${key}${version}"` : `${key}>=${version} <${nextMinor(version)}"`,
    )
  if (path.endsWith("pnpm-workspace.yaml"))
    return text.replace(
      new RegExp(`(['"])${name}@[^'"]*\\1`, "g"),
      (_, quote) => `${quote}@wirecat/${to}@${version}${quote}`,
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

const runPass = (names: Names, pass: "github" | "npm", dryRun: boolean, version: string | undefined) => {
  const total = new Map<string, number>()
  let files = 0
  for (const path of trackedFiles()) {
    const text = readText(path)
    if (text === undefined || !text.includes(names.from)) continue
    const result = rewrite(text, rules(names)[pass])
    const out = pass === "npm" && version ? repin(path, result.text, names.to, version) : result.text
    if (out === text) continue
    files += 1
    for (const [name, n] of result.counts) total.set(name, (total.get(name) ?? 0) + n)
    if (!dryRun) writeFileSync(path, out)
  }
  console.log(`${dryRun ? "would change" : "changed"} ${files} files`)
  for (const [name, n] of total) console.log(`  ${name}: ${n}`)
}

const report = (from: string) => {
  for (const path of trackedFiles()) {
    const text = readText(path)
    if (text === undefined) continue
    text.split("\n").forEach((line, index) => {
      if (line.includes(from)) console.log(`${path}:${index + 1}: ${line.trim().slice(0, 160)}`)
    })
  }
}

if (process.argv[1]?.endsWith("rename-package.ts")) {
  const args = process.argv.slice(2)
  const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
  const [from, to, pass, version] = [value("--from"), value("--to"), value("--pass"), value("--version")]
  const suffixes = value("--suffixes")?.split(",").filter(Boolean) ?? []
  const named = (name: string | undefined) => name !== undefined && /^[a-z][a-z0-9-]*$/.test(name)
  if (named(from) && args.includes("--report")) report(from as string)
  else if (named(from) && named(to) && pass === "github")
    runPass({ from: from as string, to: to as string, suffixes }, pass, args.includes("--dry-run"), undefined)
  else if (named(from) && named(to) && pass === "npm" && version && /^\d+\.\d+\.\d+$/.test(version))
    runPass({ from: from as string, to: to as string, suffixes }, pass, args.includes("--dry-run"), version)
  else {
    console.error(
      "usage: rename-package.ts --from <name> --to <name> [--suffixes a,b] --pass github [--dry-run]\n" +
        "     | rename-package.ts --from <name> --to <name> [--suffixes a,b] --pass npm --version <x.y.z> [--dry-run]\n" +
        "     | rename-package.ts --from <name> --report",
    )
    process.exit(2)
  }
}
