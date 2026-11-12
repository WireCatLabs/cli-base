import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type Run = (command: string, args: readonly string[]) => number

const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const

/**
 * Moves the CLI onto `version` of a shared package the same way every time: the pin in package.json, the lockfile,
 * the generated files and the quick checks. What the checks then report (pins, baselines) is the adoption's work.
 */
export const adopt = (cwd: string, name: string, version: string, run: Run, log: (line: string) => void): number => {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    log(`adopt takes a version such as 0.98.0, not "${version}"`)
    return 2
  }
  const path = join(cwd, "package.json")
  const pkg = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> & { scripts?: Record<string, string> }
  const found = SECTIONS.filter((section) => (pkg[section] as Record<string, string> | undefined)?.[name] !== undefined)
  if (found.length === 0) {
    log(`package.json does not depend on ${name}`)
    return 2
  }
  for (const section of found) {
    const deps = pkg[section] as Record<string, string>
    const range = (deps[name] as string).match(/^[\^~]/)?.[0] ?? ""
    deps[name] = `${range}${version}`
  }
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
  log(`${name} ${version} in package.json`)
  const steps: [string, string[]][] = [
    ["pnpm", ["install"]],
    ...(["generate", "ci:quick"] as const)
      .filter((script) => pkg.scripts?.[script] !== undefined)
      .map((script): [string, string[]] => ["pnpm", ["run", script]]),
  ]
  for (const [command, args] of steps) {
    log(`== ${command} ${args.join(" ")}`)
    const code = run(command, args)
    if (code !== 0) {
      log(`${command} ${args.join(" ")} failed (${code}): fix it on this branch, then commit`)
      return 1
    }
  }
  log(`adopted ${name} ${version}: review the diff, commit and open one pull request`)
  return 0
}
