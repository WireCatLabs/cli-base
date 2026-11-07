import { lstatSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { DISPATCH_FLAG } from "./names.js"

/**
 * The small files cli-base writes into a bin folder: the `wcat` launcher and the short-name shortcuts. Each starts a
 * program in the same folder by its stable name (`wcat-tg`), never a file inside a package: pnpm keeps packages in
 * folders named after their version, so a link into one breaks on the first upgrade.
 *
 * Every file carries a mark line, so cli-base can tell its own files from anyone else's and never touches the rest.
 */
export const SHIM_FORMAT = 2

export type ShimKind = "launcher" | "shortcut"

const MARK = /^(?:#|REM) wirecat-shim (\d+) (launcher|shortcut) (\S+)\r?$/m

export interface ShimMark {
  format: number
  kind: ShimKind
  /** The program it starts, a file name in the same folder: `wcat-tg`, `wcat-tg.cmd`. */
  target: string
}

export interface ShimFile {
  path: string
  text: string
}

const NOTE: Record<ShimKind, string> = {
  launcher: "Written by @wirecat/cli-base. Any WireCat tool rewrites it when it breaks; it is safe to delete.",
  shortcut: "Made by `wcat shortcuts add`; `wcat shortcuts remove` takes it out.",
}

const shellQuote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`

/**
 * The launcher is the entry point when the owner types `wcat`, so no tool has run to repair it: it looks for a
 * working program itself. Order: its target, another `wcat-*` of the same folder, the next `wcat` on PATH. The
 * variable stops two launchers from handing the start to each other.
 */
const launcherBody = (dir: string, target: string, name: string): string[] => [
  'ok() { [ -f "$1" ] && [ -x "$1" ]; }',
  `dir=${shellQuote(dir)}`,
  `target=${shellQuote(join(dir, target))}`,
  'if ! ok "$target"; then',
  '  for t in "$dir"/wcat-*; do',
  '    if ok "$t"; then target=$t; break; fi',
  "  done",
  "fi",
  `if ok "$target"; then exec "$target" ${DISPATCH_FLAG} "$@"; fi`,
  'if [ -z "$WIRECAT_LAUNCHER_SKIP" ]; then',
  "  WIRECAT_LAUNCHER_SKIP=1; export WIRECAT_LAUNCHER_SKIP",
  "  set -f; oldifs=$IFS; IFS=:",
  "  for d in $PATH; do",
  `    if [ -n "$d" ] && [ "$d" != "$dir" ] && ok "$d/${name}"; then IFS=$oldifs; exec "$d/${name}" "$@"; fi`,
  "  done",
  "  IFS=$oldifs; set +f",
  "fi",
  `printf '%s\\n' "${name}: $target is missing and no other ${name}-* program was found in $dir or on PATH." \\`,
  `  "This launcher is safe to delete: $dir/${name}" >&2`,
  "exit 127",
]

/**
 * The files of one shim: `<name>` on Linux and macOS; `<name>.cmd` and `<name>.ps1` on Windows, the pair npm writes
 * for its own commands. The POSIX file names the folder in full, so a link to it from elsewhere still works; the
 * Windows pair finds the folder from where it is, as npm's own wrappers do.
 */
export const shimFiles = (
  kind: ShimKind,
  { dir, name, target, platform }: { dir: string; name: string; target: string; platform: NodeJS.Platform },
): ShimFile[] => {
  const mark = `wirecat-shim ${SHIM_FORMAT} ${kind} ${target}`
  const extra = kind === "launcher" ? ` ${DISPATCH_FLAG}` : ""
  if (platform !== "win32")
    return [
      {
        path: join(dir, name),
        text: [
          "#!/bin/sh",
          `# ${mark}`,
          `# ${NOTE[kind]}`,
          ...(kind === "launcher" ? launcherBody(dir, target, name) : [`exec ${shellQuote(join(dir, target))} "$@"`]),
          "",
        ].join("\n"),
      },
    ]
  return [
    {
      path: join(dir, `${name}.cmd`),
      text: ["@ECHO off", `REM ${mark}`, `REM ${NOTE[kind]}`, `"%~dp0${target}"${extra} %*`, ""].join("\r\n"),
    },
    {
      path: join(dir, `${name}.ps1`),
      text: [
        `# ${mark}`,
        `# ${NOTE[kind]}`,
        // PowerShell hands a .cmd its arguments unquoted, so `a&b` would run `b`; npm and pnpm write a .ps1 beside
        // their .cmd, and it is started instead whenever it is there.
        `$stem = Join-Path $PSScriptRoot "${target.replace(/\.(cmd|exe|bat)$/i, "")}"`,
        `$target = if (Test-Path -LiteralPath "$stem.ps1") { "$stem.ps1" } else { Join-Path $PSScriptRoot "${target}" }`,
        "if ($MyInvocation.ExpectingInput) {",
        `  $input | & $target${extra} @args`,
        "} else {",
        `  & $target${extra} @args`,
        "}",
        "exit $LASTEXITCODE",
        "",
      ].join("\r\n"),
    },
  ]
}

export const parseShim = (text: string): ShimMark | undefined => {
  const found = MARK.exec(text.split("\n", 3).join("\n"))
  if (!found) return undefined
  return { format: Number(found[1]), kind: found[2] as ShimKind, target: found[3] as string }
}

/** A shim file is a few hundred bytes; anything larger is not one of ours and is not read. */
const MAX_SHIM_BYTES = 4096

export type FileState = { state: "missing" } | { state: "ours"; mark: ShimMark; text: string } | { state: "foreign" }

/** What sits at `path`: nothing, one of our shims, or a file or link that belongs to someone else. */
export const fileState = (path: string): FileState => {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(path)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { state: "missing" } : { state: "foreign" }
  }
  if (!stat.isFile() || stat.size > MAX_SHIM_BYTES) return { state: "foreign" }
  try {
    const text = readFileSync(path, "utf8")
    const mark = parseShim(text)
    return mark ? { state: "ours", mark, text } : { state: "foreign" }
  } catch {
    return { state: "foreign" }
  }
}

export const exists = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Written beside the target and renamed over it, so two tools starting at once never leave half a file. */
export const writeShim = ({ path, text }: ShimFile): void => {
  const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    writeFileSync(temporary, text, { mode: 0o755 })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}
