import type { CommandsDocument } from "../commands/document.js"
import type { CommandInfo, OptionInfo } from "../commands/index.js"
import { AUDIT_RULES, type AuditRule, type ParityGroup, type RequiredRoot } from "../standards/audit.js"
import { BASE_REASONS, type ErrorReason } from "../standards/errors.js"
import { LINT_RULES, OVERRIDE_BUDGET, type Override } from "../standards/lint.js"
import type { Vocabulary } from "../standards/vocabulary.js"
import { judge, kindOf, lintCommands, longName, summaryOf, walk } from "./lint.js"

export interface AuditInput {
  document: CommandsDocument
  /** As the CLI printed it, for `key-casing`. */
  raw: unknown
  schemas?: Readonly<Record<string, unknown>>
  reasons?: readonly ErrorReason[]
  /** The CLI's own `lint/` baseline and overrides; its lint rules are then judged by them, not the audit's. */
  lint?: { baseline: Readonly<Record<string, readonly string[]>>; overrides: readonly Override[]; budget: number }
}

export interface Finding {
  rule: string
  clis: string[]
  /** `<clis> <what>`: `max+tg chats list --limit`, `zm upgrade`, `tg: chats grab` for a lint violation. */
  target: string
  message: string
}

export interface ScoreRow {
  cli: string
  rule: string
  /** False when the CLI gave no input the rule reads: no schemas, no reasons. Its counts are then 0, not a pass. */
  measured: boolean
  found: number
  baseline: number
  overridden: number
  new: number
  fixed: number
  new_targets: string[]
}

export interface AuditOptions {
  groups: readonly ParityGroup[]
  roots: readonly RequiredRoot[]
  vocabulary: Vocabulary
  /** `audit/baseline/<rule>.json`, by rule. */
  baseline: Readonly<Record<string, readonly string[]>>
  blocks: "new" | "never"
  /** Only new findings that name this CLI block: the one being released. */
  only?: string
}

export interface AuditResult {
  findings: Finding[]
  rows: ScoreRow[]
  /** New findings that fail the run. */
  blocking: Finding[]
  /** What `--write-baseline` writes, by rule. */
  nextBaseline: Record<string, string[]>
  problems: string[]
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const toSnake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

const VALUE_KEYS = new Set(["default", "implies"])

/** A document from cli-base before 0.26 prints camelCase keys; the audit reads both, `key-casing` still reports it. */
export const snakeKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(snakeKeys)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [toSnake(key), VALUE_KEYS.has(key) ? item : snakeKeys(item)]),
  )
}

/** The CLIs a target names: `max+tg chats list` → max, tg; `tg: chats grab` → tg. */
export const clisOf = (target: string): string[] => (target.split(" ")[0] ?? "").replace(/:$/, "").split("+")

const named = (clis: readonly string[]) => [...clis].sort(byText).join("+")

const handwritten = (document: CommandsDocument): Map<string, CommandInfo> =>
  new Map(
    walk(document.commands)
      .filter((command) => command.origin === "handwritten")
      .map((command) => [command.path.join(" "), command]),
  )

const requiredRoots = (inputs: readonly AuditInput[], roots: readonly RequiredRoot[]): Finding[] =>
  inputs.flatMap(({ document }) => {
    const paths = new Set(walk(document.commands).map((command) => command.path.join(" ")))
    return roots
      .filter((root) => !paths.has(root.path.join(" ")))
      .map((root) => ({
        rule: "required-root",
        clis: [document.cli],
        target: `${document.cli} ${root.path.join(" ")}`,
        message: `no "${root.path.join(" ")}": ${root.meaning}`,
      }))
  })

const describe = (values: ReadonlyMap<string, string>) =>
  [...values].map(([cli, value]) => `${cli}: ${value}`).join(", ")

const optionKinds = (options: readonly OptionInfo[]) =>
  new Map(options.map((option) => [longName(option.flags), kindOf(option)]))

const shownKind = (kind: string | undefined) => (kind === undefined ? "absent" : kind === "switch" ? kind : `<${kind}>`)

const samePathContract = (inputs: readonly AuditInput[], groups: readonly ParityGroup[]): Finding[] => {
  const trees = new Map(inputs.map(({ document }) => [document.cli, handwritten(document)]))
  const paths = [...new Set([...trees.values()].flatMap((tree) => [...tree.keys()]))].sort(byText)
  const found: Finding[] = []
  for (const path of paths) {
    const root = path.split(" ")[0] ?? ""
    const covering = groups.filter((group) => group.covers === "tree" || group.covers.includes(root))
    for (const group of covering.filter((one) => one.covers === "tree")) {
      const present = group.members.filter((cli) => trees.has(cli))
      const having = present.filter((cli) => trees.get(cli)?.has(path))
      if (present.length >= 2 && having.length > 0 && having.length < present.length)
        found.push({
          rule: "same-path-contract",
          clis: [...present].sort(byText),
          target: `${named(present)} ${path}: presence`,
          message: `only in ${having.join(", ")}`,
        })
    }
    const having = [...new Set(covering.flatMap((group) => group.members))]
      .filter((cli) => trees.get(cli)?.has(path))
      .sort(byText)
    if (having.length < 2) continue
    const commands = new Map(having.map((cli) => [cli, trees.get(cli)?.get(path) as CommandInfo]))
    const push = (what: string, values: Map<string, string>) => {
      if (new Set(values.values()).size > 1)
        found.push({
          rule: "same-path-contract",
          clis: having,
          target: `${named(having)} ${path}${what}`,
          message: describe(values),
        })
    }
    const kinds = new Map([...commands].map(([cli, command]) => [cli, optionKinds(command.options)]))
    const flags = [...new Set([...kinds.values()].flatMap((one) => [...one.keys()]))].sort(byText)
    for (const flag of flags) push(` ${flag}`, new Map([...kinds].map(([cli, one]) => [cli, shownKind(one.get(flag))])))
    push(
      ": output",
      new Map(
        [...commands].map(([cli, command]) => [
          cli,
          command.output ? [command.output.entity, command.output.view].filter(Boolean).join("/") : "none",
        ]),
      ),
    )
    const own = (cli: string, text: string) => text.replace(new RegExp(`\\b${cli}\\b`, "g"), "<cli>")
    push(
      ": summary",
      new Map([...commands].map(([cli, command]) => [cli, JSON.stringify(own(cli, summaryOf(command)))])),
    )
  }
  return found
}

const sameFlagMeaning = (inputs: readonly AuditInput[]): Finding[] => {
  const uses = new Map<string, Map<string, Set<string>>>()
  for (const { document } of inputs) {
    const options = [
      ...document.global_options,
      ...walk(document.commands)
        .filter((command) => command.origin === "handwritten")
        .flatMap((command) => command.options),
    ]
    for (const option of options) {
      const name = longName(option.flags)
      if (!name.startsWith("--")) continue
      const byCli = uses.get(name) ?? new Map<string, Set<string>>()
      byCli.set(document.cli, (byCli.get(document.cli) ?? new Set()).add(shownKind(kindOf(option))))
      uses.set(name, byCli)
    }
  }
  return [...uses]
    .sort(([a], [b]) => byText(a, b))
    .flatMap(([flag, byCli]) => {
      const signatures = new Map([...byCli].map(([cli, kinds]) => [cli, [...kinds].sort(byText).join(" | ")]))
      if (byCli.size < 2 || new Set(signatures.values()).size < 2) return []
      const clis = [...byCli.keys()].sort(byText)
      return [{ rule: "same-flag-meaning", clis, target: `${named(clis)} ${flag}`, message: describe(signatures) }]
    })
}

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, item) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => byText(a, b)))
      : item,
  )

const sameEntitySchema = (inputs: readonly AuditInput[]): Finding[] => {
  const schemas = new Map<string, Map<string, string>>()
  for (const { document, schemas: own } of inputs) {
    if (!own) continue
    const entities = new Set(
      walk(document.commands).flatMap((command) =>
        [command.output?.entity, command.query?.entity].filter((one): one is string => one !== undefined),
      ),
    )
    for (const entity of entities)
      if (own[entity] !== undefined)
        schemas.set(entity, (schemas.get(entity) ?? new Map()).set(document.cli, canonical(own[entity])))
  }
  return [...schemas]
    .sort(([a], [b]) => byText(a, b))
    .flatMap(([entity, byCli]) => {
      if (byCli.size < 2 || new Set(byCli.values()).size < 2) return []
      const clis = [...byCli.keys()].sort(byText)
      const groups = [...new Set(byCli.values())].map((schema) =>
        [...byCli].filter(([, one]) => one === schema).map(([cli]) => cli),
      )
      return [
        {
          rule: "same-entity-schema",
          clis,
          target: `${named(clis)} entity ${entity}`,
          message: `${groups.length} different schemas: ${groups.map((one) => one.join(", ")).join(" / ")}`,
        },
      ]
    })
}

const BASE = "cli-base"

const sameErrorReason = (inputs: readonly AuditInput[]): Finding[] => {
  const owned = [
    ...BASE_REASONS.map((reason) => ({ owner: BASE, reason })),
    ...inputs.flatMap(({ document, reasons }) => (reasons ?? []).map((reason) => ({ owner: document.cli, reason }))),
  ]
  const found: Finding[] = []
  const push = (clis: string[], what: string, message: string) =>
    found.push({ rule: "same-error-reason", clis, target: `${named(clis)} ${what}`, message })
  const by = (key: (entry: (typeof owned)[number]) => string) => {
    const groups = new Map<string, typeof owned>()
    for (const entry of owned) groups.set(key(entry), [...(groups.get(key(entry)) ?? []), entry])
    return [...groups].sort(([a], [b]) => byText(a, b))
  }
  for (const [, entries] of by(({ reason }) => `${reason.code} ${reason.message.trim().toLowerCase()}`)) {
    const ids = [...new Set(entries.map(({ reason }) => reason.reason))].sort(byText)
    const clis = [...new Set(entries.map(({ owner }) => owner).filter((owner) => owner !== BASE))].sort(byText)
    if (ids.length > 1 && clis.length > 0)
      push(clis, `reason ${ids.join("=")}`, `one failure under ${ids.length} names: "${entries[0]?.reason.message}"`)
  }
  for (const [id, entries] of by(({ reason }) => reason.reason)) {
    const codes = new Map(entries.map(({ owner, reason }) => [owner, reason.code]))
    const clis = [...codes.keys()].filter((owner) => owner !== BASE).sort(byText)
    if (new Set(codes.values()).size > 1 && clis.length > 0) push(clis, `reason ${id}: code`, describe(codes))
  }
  return found
}

const CROSS: Record<string, (inputs: readonly AuditInput[], options: AuditOptions) => Finding[]> = {
  "required-root": (inputs, options) => requiredRoots(inputs, options.roots),
  "same-path-contract": (inputs, options) => samePathContract(inputs, options.groups),
  "same-flag-meaning": (inputs) => sameFlagMeaning(inputs),
  "same-entity-schema": (inputs) => sameEntitySchema(inputs),
  "same-error-reason": (inputs) => sameErrorReason(inputs),
}

const measuredBy: Record<string, (input: AuditInput) => boolean> = {
  "same-entity-schema": (input) => input.schemas !== undefined,
  "same-error-reason": (input) => input.reasons !== undefined,
}

export const auditClis = (
  inputs: readonly AuditInput[],
  options: AuditOptions,
  rules: readonly AuditRule[] = AUDIT_RULES,
): AuditResult => {
  const problems: string[] = []
  const clis = inputs.map(({ document }) => document.cli)
  for (const cli of new Set(clis.filter((one, index) => clis.indexOf(one) !== index)))
    problems.push(`${cli} is given twice`)
  const lintIds = LINT_RULES.map((rule) => rule.id)
  const known = new Set([...lintIds, ...rules.map((rule) => rule.id)])
  for (const rule of Object.keys(options.baseline))
    if (!known.has(rule)) problems.push(`no lint or audit rule "${rule}" (named in the baseline)`)
  for (const group of options.groups)
    for (const entry of group.differences)
      if (!known.has(entry.rule)) problems.push(`no audit rule "${entry.rule}" (a difference in ${group.name})`)

  const lint = new Map(
    inputs.map((input) => [
      input.document.cli,
      lintCommands(input.document, options.vocabulary, LINT_RULES, { raw: input.raw, schemas: input.schemas }),
    ]),
  )
  const findings: Finding[] = [
    ...inputs.flatMap(({ document }) =>
      (lint.get(document.cli) ?? []).map((violation) => ({
        rule: violation.rule,
        clis: [document.cli],
        target: `${document.cli}: ${violation.target}`,
        message: violation.message,
      })),
    ),
    ...rules.flatMap((rule) => {
      const check = CROSS[rule.id]
      if (!check) throw new Error(`audit rule "${rule.id}" has no check`)
      return check(inputs, options)
    }),
  ]

  const declared = new Map(
    options.groups.flatMap((group) => group.differences.map((entry) => [`${entry.rule} ${entry.target}`, group.name])),
  )
  const found = new Set(findings.map((finding) => `${finding.rule} ${finding.target}`))
  for (const [key, group] of declared)
    if (!found.has(key)) problems.push(`stale difference in ${group}, no such divergence — remove it: ${key}`)
  for (const group of options.groups)
    if (group.differences.length > OVERRIDE_BUDGET)
      problems.push(`${group.name} declares ${group.differences.length} differences; the budget is ${OVERRIDE_BUDGET}`)

  const baselined = new Set(
    Object.entries(options.baseline).flatMap(([rule, targets]) => targets.map((target) => `${rule} ${target}`)),
  )
  const ownLint = (cli: string, rule: string) =>
    lintIds.includes(rule) ? inputs.find((input) => input.document.cli === cli)?.lint : undefined

  const rows: ScoreRow[] = []
  const blocking: Finding[] = []
  for (const input of inputs) {
    const cli = input.document.cli
    for (const rule of [...lintIds, ...rules.map((one) => one.id)]) {
      const mine = findings.filter((finding) => finding.rule === rule && finding.clis.includes(cli))
      const own = ownLint(cli, rule)
      let row: ScoreRow
      if (own) {
        const violations = (lint.get(cli) ?? []).filter((violation) => violation.rule === rule)
        const verdict = judge(violations, { [rule]: own.baseline[rule] ?? [] }, own.overrides, own.budget)
        row = {
          cli,
          rule,
          measured: true,
          found: violations.length,
          baseline: verdict.baselined,
          overridden: verdict.overridden,
          new: verdict.fresh.length,
          fixed: verdict.stale.filter((entry) => entry.in === "baseline").length,
          new_targets: verdict.fresh.map((violation) => `${cli}: ${violation.target}`),
        }
        blocking.push(...mine.filter((finding) => row.new_targets.includes(finding.target)))
      } else {
        const open = mine.filter((finding) => !declared.has(`${rule} ${finding.target}`))
        const fresh = open.filter((finding) => !baselined.has(`${rule} ${finding.target}`))
        const here = new Set(mine.map((finding) => finding.target))
        row = {
          cli,
          rule,
          measured: measuredBy[rule]?.(input) ?? true,
          found: mine.length,
          baseline: open.length - fresh.length,
          overridden: mine.length - open.length,
          new: fresh.length,
          fixed: (options.baseline[rule] ?? []).filter(
            (target) => clisOf(target).includes(cli) && (!here.has(target) || declared.has(`${rule} ${target}`)),
          ).length,
          new_targets: fresh.map((finding) => finding.target),
        }
        const blocks = lintIds.includes(rule) || options.blocks === "new"
        if (blocks) blocking.push(...fresh)
      }
      rows.push(row)
    }
  }

  const selfJudged = new Set(inputs.filter((input) => input.lint).map((input) => input.document.cli))
  const nextBaseline = Object.fromEntries(
    [...lintIds, ...rules.map((rule) => rule.id)].map((rule) => {
      const kept = (options.baseline[rule] ?? []).filter((target) => !clisOf(target).some((cli) => clis.includes(cli)))
      const now = findings
        .filter((finding) => finding.rule === rule && !declared.has(`${rule} ${finding.target}`))
        .filter((finding) => !(lintIds.includes(rule) && selfJudged.has(finding.clis[0] ?? "")))
        .map((finding) => finding.target)
      return [rule, [...new Set([...kept, ...now])].sort(byText)]
    }),
  )

  const unique = new Map(blocking.map((finding) => [`${finding.rule} ${finding.target}`, finding]))
  return {
    findings,
    rows,
    blocking: [...unique.values()].filter(
      (finding) => options.only === undefined || finding.clis.includes(options.only),
    ),
    nextBaseline,
    problems,
  }
}

const pad = (cells: readonly string[], widths: readonly number[]) =>
  cells
    .map((cell, index) => (index < 2 ? cell.padEnd(widths[index] ?? 0) : cell.padStart(widths[index] ?? 0)))
    .join("  ")

/** One line per CLI and rule that found something, then one total per CLI. */
export const scorecardTable = (rows: readonly ScoreRow[]): string => {
  const header = ["cli", "rule", "found", "baseline", "overridden", "new", "fixed"]
  const cells = (row: ScoreRow) =>
    row.measured
      ? [row.cli, row.rule, ...[row.found, row.baseline, row.overridden, row.new, row.fixed].map(String)]
      : [row.cli, row.rule, "n/a", "n/a", "n/a", "n/a", "n/a"]
  const shown = rows.filter((row) => !row.measured || row.found > 0 || row.fixed > 0)
  const totals = [...new Set(rows.map((row) => row.cli))].map((cli) => {
    const mine = rows.filter((row) => row.cli === cli && row.measured)
    const sum = (key: "found" | "baseline" | "overridden" | "new" | "fixed") =>
      String(mine.reduce((total, row) => total + row[key], 0))
    return [cli, "total", sum("found"), sum("baseline"), sum("overridden"), sum("new"), sum("fixed")]
  })
  const lines = [header, ...shown.map(cells), ...totals]
  const widths = header.map((_, index) => Math.max(...lines.map((line) => line[index]?.length ?? 0)))
  return lines.map((line) => pad(line, widths).trimEnd()).join("\n")
}
