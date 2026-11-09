import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { hostCovered } from "../http/hosts.js"

export interface SourceFile {
  /** Relative to the CLI's root, with `/`: `src/api/client.ts`. */
  path: string
  text: string
}

/** What a run of `cli-dev lint` knows about the CLI's network: its own source and what its manifest declares. */
export interface NetworkContext {
  sources: readonly SourceFile[]
  /** `network.hosts` of the shipped manifest; absent when it declares none, and the host check is skipped. */
  hosts?: readonly string[]
  docsHost?: string
}

const NETWORK_MODULES = /^(?:(?:node:)?(?:http|https|http2|net|tls|dgram)|undici|axios|got|node-fetch|ws)(?:\/.*)?$/
const SKIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  "test",
  "tests",
  "testing",
  "__tests__",
  "fixtures",
  "__fixtures__",
])
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const NOT_SOURCE = /\.(?:test|spec)\.[^.]+$|\.d\.[cm]?ts$/

/** The CLI's own source under `src`; tests, fixtures and the fakes in `src/testing` left out. */
export const readSources = (cwd: string, dir = "src"): SourceFile[] => {
  const root = join(cwd, dir)
  if (!existsSync(root)) return []
  const walk = (at: string): SourceFile[] =>
    readdirSync(at).flatMap((name) => {
      const path = join(at, name)
      if (statSync(path).isDirectory()) return SKIPPED_DIRS.has(name) ? [] : walk(path)
      return SOURCE_FILE.test(name) && !NOT_SOURCE.test(name)
        ? [{ path: relative(cwd, path).split("\\").join("/"), text: readFileSync(path, "utf8") }]
        : []
    })
  return walk(root).sort((a, b) => (a.path < b.path ? -1 : 1))
}

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/
const MODULE_REF =
  /\b(?:import\s+(type\s+)?(?:([\w$*{}\s,]+?)\s+from\s*)?|export\s+(type\s+)?[\w$*{}\s,]*?\s*from\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g
// A server only listens and `isIP` only parses: neither reaches a host, so hostFetch has nothing to replace.
const OPENS_NOTHING: Readonly<Record<string, ReadonlySet<string>>> = {
  http: new Set(["createServer", "STATUS_CODES", "METHODS"]),
  https: new Set(["createServer"]),
  net: new Set(["isIP", "isIPv4", "isIPv6"]),
}

const opensNothing = (module: string, clause: string | undefined): boolean => {
  const allowed = OPENS_NOTHING[module.replace(/^node:/, "")]
  const named = clause?.trim().match(/^\{([^}]*)\}$/)?.[1]
  if (!allowed || named === undefined) return false
  return named
    .split(",")
    .map((binding) => binding.trim())
    .filter((binding) => binding !== "" && !binding.startsWith("type "))
    .every((binding) => allowed.has(binding.split(/\s+as\s+/)[0] as string))
}

// A file that binds its own `fetch` (an injected FetchLike, `const fetch = hostFetch(…)`) calls that one.
const BINDS_FETCH = /\b(?:const|let|var|function)\s+fetch\b|[{,(]\s*fetch\s*[,}):=]/
const GLOBAL_FETCH = /(?<!\btypeof\s+)\b(?:globalThis|window|self)\s*\.\s*fetch\b/
// A call, or a value handed on to be called later (`options.fetch ?? fetch`); a key (`fetch:`) or a type reaches nothing.
const GLOBAL_FETCH_USE = /(?<![\w$.#]|\btypeof\s+)fetch\b(?![\w$]|\s*\??\s*:)/
const STRINGS_AND_COMMENTS = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g

const usesGlobalFetch = (code: string) => GLOBAL_FETCH_USE.test(code.replace(STRINGS_AND_COMMENTS, '""'))

export const rawNetwork = ({ sources }: NetworkContext): { target: string; message: string }[] =>
  sources.flatMap(({ path, text }) => {
    const code = text
      .split("\n")
      .filter((line) => !COMMENT_LINE.test(line))
      .join("\n")
    const modules = [...code.matchAll(MODULE_REF)]
      .filter(
        ([, type, clause, exportType, module]) =>
          !type && !exportType && module && NETWORK_MODULES.test(module) && !opensNothing(module, clause),
      )
      .map(([, , , , module]) => module as string)
    const fetches = [
      ...(GLOBAL_FETCH.test(code) || (!BINDS_FETCH.test(code) && usesGlobalFetch(code)) ? ["fetch"] : []),
    ]
    return [...new Set([...modules, ...fetches])].map((what) => ({
      target: `${path} ${what}`,
      message:
        what === "fetch"
          ? "uses the global fetch: use hostFetch from @wirecat/cli-base/http, which reaches only the declared hosts"
          : `imports ${what}: send HTTP through hostFetch from @wirecat/cli-base/http, or say why in lint/overrides.json`,
    }))
  })

const URL_HOST = /\bhttps?:\/\/([a-z0-9.-]+)/gi
/** Names, not addresses: placeholders and schema or namespace identifiers nobody fetches. */
const NOT_CONTACTED = /(?:^|\.)(?:example(?:\.com|\.org|\.net)?|test|invalid)$|^(?:json-schema\.org|www\.w3\.org)$/

/** One finding per host, so a host named in many files takes one override. */
export const undeclaredHosts = ({
  sources,
  hosts,
  docsHost,
}: NetworkContext): { target: string; message: string }[] => {
  if (hosts === undefined) return []
  const files = new Map<string, string[]>()
  for (const { path, text } of sources)
    for (const line of text.split("\n"))
      if (!COMMENT_LINE.test(line))
        for (const [, found] of line.matchAll(URL_HOST)) {
          const host = (found as string).toLowerCase().replace(/\.$/, "")
          // A name with no dot (`socks5://host:port`) is a placeholder or this machine, not an internet host.
          if (!host.includes(".") || host === docsHost || NOT_CONTACTED.test(host) || hostCovered(host, hosts)) continue
          const seen = files.get(host) ?? []
          if (!seen.includes(path)) files.set(host, [...seen, path])
        }
  return [...files].map(([host, paths]) => ({
    target: host,
    message: `named in ${paths.join(", ")} but not in network.hosts: add it to \`hosts\` in the WCAT identity and run cli-dev manifest`,
  }))
}
