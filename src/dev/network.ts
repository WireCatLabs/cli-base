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

const MODULE_REF =
  /\b(?:import\s+(type\s+)?(?:[\w$*{}\s,]+?\s+from\s*)?|export\s+(type\s+)?[\w$*{}\s,]*?\s*from\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g
// A file that binds its own `fetch` (an injected FetchLike, `const fetch = hostFetch(…)`) calls that one.
const BINDS_FETCH = /\b(?:const|let|var|function)\s+fetch\b|[{,(]\s*fetch\s*[,}):=]/
const GLOBAL_FETCH_CALL = /(?<![\w$.])fetch\s*\(/
const GLOBAL_FETCH = /(?<!\btypeof\s+)\b(?:globalThis|window|self)\s*\.\s*fetch\b/

export const rawNetwork = ({ sources }: NetworkContext): { target: string; message: string }[] =>
  sources.flatMap(({ path, text }) => {
    const modules = [...text.matchAll(MODULE_REF)]
      .filter(([, type, exportType, module]) => !type && !exportType && module && NETWORK_MODULES.test(module))
      .map(([, , , module]) => module as string)
    const fetches = [
      ...(GLOBAL_FETCH.test(text) || (GLOBAL_FETCH_CALL.test(text) && !BINDS_FETCH.test(text)) ? ["fetch"] : []),
    ]
    return [...new Set([...modules, ...fetches])].map((what) => ({
      target: `${path} ${what}`,
      message:
        what === "fetch"
          ? "calls the global fetch: use hostFetch from @wirecat/cli-base/http, which reaches only the declared hosts"
          : `imports ${what}: send HTTP through hostFetch from @wirecat/cli-base/http, or say why in lint/overrides.json`,
    }))
  })

const URL_HOST = /\bhttps?:\/\/([a-z0-9.-]+)/gi
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/
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
          if (host === docsHost || NOT_CONTACTED.test(host) || hostCovered(host, hosts)) continue
          const seen = files.get(host) ?? []
          if (!seen.includes(path)) files.set(host, [...seen, path])
        }
  return [...files].map(([host, paths]) => ({
    target: host,
    message: `named in ${paths.join(", ")} but not in network.hosts: add it to \`hosts\` in the WCAT identity and run cli-dev manifest`,
  }))
}
