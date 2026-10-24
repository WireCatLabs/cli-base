import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const workflow = readFileSync(new URL("../.github/workflows/release-checks.yml", import.meta.url), "utf8")

function gateScript(): string {
  const lines = workflow.split("\n")
  const start = lines.findIndex((line) => line.includes("<<'PYCODE'"))
  const end = lines.findIndex((line, index) => index > start && line.trim() === "PYCODE")
  const indent = lines[end]?.match(/^ */)?.[0].length ?? 0
  return lines
    .slice(start + 1, end)
    .map((line) => line.slice(indent))
    .join("\n")
}

const rule = (id: string, severity?: string) => ({
  id,
  properties: severity === undefined ? {} : { "security-severity": severity },
})

function sarif(driverRules: object[], extensionRules: object[][], results: object[]) {
  return {
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: { name: "CodeQL", rules: driverRules },
          extensions: extensionRules.map((rules, index) => ({ name: `pack-${index}`, rules })),
        },
        results,
      },
    ],
  }
}

function gate(...reports: object[]) {
  const dir = mkdtempSync(join(tmpdir(), "codeql-gate-"))
  const sarifDir = join(dir, "sarif")
  mkdirSync(sarifDir)
  for (const [index, report] of reports.entries()) {
    writeFileSync(join(sarifDir, `${index}.sarif`), JSON.stringify(report))
  }
  return spawnSync("python3", ["-I", "-", "sarif"], { cwd: dir, input: gateScript(), encoding: "utf8" })
}

// The shape CodeQL 2.27 writes: driver.rules empty, every rule in an extension, results point at it.
const inExtension = (ruleIndex: number) => ({
  ruleId: "x",
  rule: { id: "x", toolComponent: { index: 0 }, index: ruleIndex },
})

describe("release-checks critical source findings", () => {
  it("extracts a non-empty script from the workflow", () => {
    expect(gateScript()).toContain("def resolve(")
  })

  it("blocks a 9.8 finding whose rule lives in an extension", () => {
    const run = gate(sarif([], [[rule("js/low", "7.8"), rule("js/critical", "9.8")]], [inExtension(1)]))
    expect(run.stdout).toContain("1 critical findings")
    expect(run.status).toBe(1)
  })

  it("passes when every finding is below critical", () => {
    const run = gate(sarif([], [[rule("js/low", "7.8"), rule("js/quality")]], [inExtension(0), inExtension(1)]))
    expect(run.stdout).toContain("0 critical findings")
    expect(run.status).toBe(0)
  })

  it("fails when a finding's rule cannot be found", () => {
    const run = gate(
      sarif([], [[rule("js/low", "7.8")]], [{ ruleId: "js/missing", rule: { toolComponent: { index: 0 }, index: 5 } }]),
    )
    expect(run.stderr).toContain("js/missing")
    expect(run.status).toBe(1)
  })

  it("still reads rules from the driver", () => {
    const report = sarif(
      [rule("js/low", "7.8"), rule("js/critical", "9.1")],
      [],
      [{ ruleId: "js/critical", ruleIndex: 1 }],
    )
    expect(gate(report).status).toBe(1)
    expect(gate(sarif([rule("js/low", "7.8")], [], [{ ruleId: "js/low", ruleIndex: 0 }])).status).toBe(0)
  })

  it("falls back to the rule id across the driver and every extension", () => {
    const run = gate(sarif([], [[rule("js/low", "7.8")], [rule("js/critical", "9.0")]], [{ ruleId: "js/critical" }]))
    expect(run.status).toBe(1)
  })

  it("fails when there is no report or it is not SARIF", () => {
    expect(gate().status).toBe(1)
    expect(gate({ version: "2.1.0" }).status).toBe(1)
  })
})

describe("release-checks fresh dependency resolution", () => {
  const start = workflow.indexOf("      - name: Audit a fresh production install of the package")
  const script =
    workflow
      .slice(start)
      .split("        run: |\n")[1]
      ?.split("\n  go-dependencies:")[0]
      ?.split("\n")
      .map((line) => line.slice(10))
      .join("\n") ?? ""

  it.each([0, 1])("propagates npm audit status %s after packing and resolving outside the checkout", (status) => {
    const root = mkdtempSync(join(tmpdir(), "dependency-gate-"))
    const bin = join(root, "bin")
    mkdirSync(bin)
    const log = join(root, "calls")
    const npm = join(bin, "npm")
    writeFileSync(
      npm,
      `#!/bin/sh
printf '%s|%s\\n' "$PWD" "$*" >> "$CALLS"
case "$1" in
  pack) touch "$4/package.tgz" ;;
  audit) exit "$AUDIT_STATUS" ;;
esac
`,
    )
    chmodSync(npm, 0o755)
    const run = spawnSync("sh", ["-eu", "-c", script], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: log, AUDIT_STATUS: String(status) },
      encoding: "utf8",
    })
    expect(run.stderr).toBe("")
    expect(run.status).toBe(status)
    const calls = readFileSync(log, "utf8").trim().split("\n")
    expect(calls[0]).toMatch(/pack --ignore-scripts --pack-destination /)
    expect(calls[1]).not.toMatch(new RegExp(`^${root}\\|`))
    expect(calls[2]).toContain("install --package-lock-only --ignore-scripts --omit=dev --no-audit --no-fund")
    expect(calls[2]).toContain("/package.tgz")
    expect(calls[3]).toContain("audit --omit=dev --audit-level=high")
  })
})
