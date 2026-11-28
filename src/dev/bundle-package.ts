/**
 * `bundlePackage`: a library such as cli-base or cli-core ships its `exports` pre-bundled, so a CLI that loads it from
 * the package reads a few dozen chunks instead of about a thousand files, and every CLI on one version shares them.
 *
 * - Every `exports` entry whose `default` is under `./dist/bundle/` is built from the tsc output its `types` names, in
 *   one esbuild build: two builds would give two copies of a module both reach, and of its state.
 * - A module keeps its own place: `import.meta.url` is its file under `dist/`, so files beside it are found as before.
 *   The place is only a path: a package may delete its unbundled `.js` files after the build.
 * - Peers, optional dependencies and natives stay outside; the package's other dependencies go inside.
 * - `merge` names the entries a start loads. esbuild makes one chunk per set of entries that reach a module, so a start
 *   reads dozens of small files; rolldown then puts everything those entries load statically into one chunk. Fewer
 *   files is what keeps a CLI's start near its old single-bundle time.
 * - `./preload`, when `exports` names it, is written here: it loads every chunk and entry, for a server that an upgrade
 *   must not leave without one.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { isBuiltin } from "node:module"
import { basename, join, relative, sep } from "node:path"
import type { Plugin } from "esbuild"
import { commonJsNames, DEFAULT_EXTERNAL, DEFAULT_HARMLESS, matcher } from "./bundle.js"

export interface PackageBundleOptions {
  /** The package's root: `dist/` and `package.json` are under it. */
  root: string
  /** More entries, by bundle name, e.g. a bin: `{ "cli-dev": "dist/dev/bin.js" }`. */
  entries?: Readonly<Record<string, string>>
  /** Packages that stay outside, besides peers, optional dependencies and `DEFAULT_EXTERNAL`. */
  external?: readonly string[]
  /** Third-party files read and found harmless, besides `DEFAULT_HARMLESS` (a path suffix each). */
  harmless?: readonly string[]
  /**
   * Bundle names of the entries a start loads, whose static closure becomes one chunk. Needs `rolldown`. Ordered
   * groups, `[["start"], ["index"]]`, give one chunk each: a group takes its closure less what earlier groups took, so
   * a small entry that shares a few modules with a large one does not load the large one's chunk.
   */
  merge?: readonly string[] | readonly (readonly string[])[]
  /** Bundle names of entries `./preload` must not import, because importing them acts: `testing-setup`. */
  quiet?: readonly string[]
}

export interface PackageBundleResult {
  problems: string[]
  /** What `./preload` loads: every file of the bundle but the bins and the `quiet` entries. */
  chunks: string[]
}

const posix = (path: string) => path.split(sep).join("/")

const PRELOAD = "./preload"

// The rewrite goes through esbuild, not text: a module may hold `import.meta.url` in a string, as `bundle.ts` does.
export const packagePlaces = (dist: string, out: string, harmless: readonly string[], problems: string[]): Plugin => ({
  name: "package-places",
  setup(context) {
    context.onLoad({ filter: /\.[cm]?js$/ }, async (args) => {
      const source = readFileSync(args.path, "utf8")
      if (!args.path.startsWith(dist + sep)) {
        const known = harmless.some((path) => posix(args.path).endsWith(path))
        if (!known && /import\.meta|__dirname|__filename|require\.resolve/.test(source)) problems.push(args.path)
        return undefined
      }
      if (!source.includes("import.meta")) return undefined
      const { transform } = await import("esbuild")
      const { code } = await transform(source, {
        define: { "import.meta.url": "__ownPlace" },
        format: "esm",
        loader: "js",
        target: "esnext",
      })
      const place = `new URL(${JSON.stringify(posix(relative(out, args.path)))}, import.meta.url).href`
      const [, hashbang = "", body = code] = code.match(/^(#![^\n]*\n)?([\s\S]*)$/) ?? []
      return { contents: `${hashbang}const __ownPlace = ${place};\n${body}`, loader: "js" }
    })
  },
})

const STATIC_CHUNK = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*"\.\/([^"]+)"|(?:^|\n)import\s*"\.\/([^"]+)"/g

/** esbuild's chunks, regrouped by rolldown: what each group's roots load statically becomes one chunk. */
const mergeChunks = async (
  from: string,
  to: string,
  entries: readonly string[],
  merge: readonly string[] | readonly (readonly string[])[],
): Promise<void> => {
  const { rolldown } = await import("rolldown")
  const isEntry = new Set(entries.map((name) => `${name}.js`))
  const imported = (file: string) =>
    [...readFileSync(join(from, file), "utf8").matchAll(STATIC_CHUNK)].map(([, named, bare]) => named ?? bare ?? "")
  const closure = (roots: readonly string[]) => {
    const seen = new Set<string>()
    const stack = roots.map((name) => `${name}.js`)
    for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
      if (seen.has(file)) continue
      seen.add(file)
      stack.push(...imported(file))
    }
    return seen
  }
  const ordered = merge.every((item) => typeof item === "string")
    ? [merge as readonly string[]]
    : (merge as readonly (readonly string[])[])
  const taken = new Set<string>()
  const groups = ordered.map((roots, at) => {
    const own = new Set([...closure(roots)].filter((file) => !isEntry.has(file) && !taken.has(file)))
    for (const file of own) taken.add(file)
    return {
      name: roots[0] ?? `group${at}`,
      test: (id: string) => own.has(basename(id)),
      priority: ordered.length - at,
    }
  })
  const build = await rolldown({
    input: Object.fromEntries(entries.map((name) => [name, join(from, `${name}.js`)])),
    external: (id, importer) => importer !== undefined && !id.startsWith(".") && !id.startsWith("/"),
    preserveEntrySignatures: "strict",
    platform: "node",
    treeshake: false,
    logLevel: "warn",
  })
  await build.write({
    dir: to,
    format: "es",
    entryFileNames: "[name].js",
    chunkFileNames: "[name]-[hash].js",
    keepNames: true,
    codeSplitting: { groups },
  })
  await build.close()
}

/**
 * `./preload`: after an upgrade the chunks on disk are another version's, so a server loads them all while they are
 * its own, and finds one it holds without looking on disk.
 */
const preloadSource = (chunks: readonly string[]) => `import * as module from "node:module"

const chunks = ${JSON.stringify(chunks)}
let loading
export const preload = () => {
  if (!loading) {
    if (module.registerHooks) {
      const bundle = new URL("./", import.meta.url).href
      module.registerHooks({
        resolve: (specifier, context, next) =>
          specifier.startsWith("./") && context.parentURL?.startsWith(bundle)
            ? { url: new URL(specifier, context.parentURL).href, format: "module", shortCircuit: true }
            : next(specifier, context),
      })
    }
    loading = Promise.allSettled(chunks.map((chunk) => import(chunk))).then(() => undefined)
  }
  return loading
}
`

export const bundlePackage = async (options: PackageBundleOptions): Promise<PackageBundleResult> => {
  const { build } = await import("esbuild")
  const root = options.root
  const dist = join(root, "dist")
  const out = join(dist, "bundle")
  const manifestPath = join(root, "package.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    exports?: Record<string, unknown>
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
  const problems: string[] = []
  const entryPoints: Record<string, string> = {}
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    if (key === PRELOAD || typeof value !== "object" || value === null) continue
    const { types, default: entry } = value as { types?: unknown; default?: unknown }
    if (typeof entry !== "string" || !entry.startsWith("./dist/bundle/")) continue
    if (typeof types !== "string" || !types.endsWith(".d.ts")) {
      problems.push(`exports["${key}"] has no types to find its source by`)
      continue
    }
    entryPoints[basename(entry).replace(/\.js$/, "")] = join(root, types.replace(/\.d\.ts$/, ".js"))
  }
  for (const [name, file] of Object.entries(options.entries ?? {})) entryPoints[name] = join(root, file)
  if (problems.length > 0) return { problems, chunks: [] }

  const outside = [...Object.keys(manifest.peerDependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})]
  const external = [...DEFAULT_EXTERNAL, ...outside.flatMap((name) => [name, `${name}/*`]), ...(options.external ?? [])]
  const installed = new Set([...outside, ...Object.keys(manifest.dependencies ?? {})])
  const isExternal = matcher(external)

  const split = options.merge ? `${out}.split` : out
  rmSync(out, { recursive: true, force: true })
  rmSync(split, { recursive: true, force: true })
  const { metafile } = await build({
    absWorkingDir: root,
    entryPoints,
    outdir: split,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node22",
    chunkNames: "[name]-[hash]",
    keepNames: true,
    external,
    // Its own name: a CLI that bundles this package privately prints its banner above it, `__bundleRequire` included.
    banner: {
      js: 'import { createRequire as __packageRequire } from "node:module";\nconst require = __packageRequire(import.meta.url);',
    },
    plugins: [commonJsNames, packagePlaces(dist, out, [...DEFAULT_HARMLESS, ...(options.harmless ?? [])], problems)],
    metafile: true,
    logLevel: "silent",
  })
  // From a chunk, an outside package resolves from the package's root: only its own dependencies are there.
  for (const [input, { imports }] of Object.entries(metafile.inputs)) {
    for (const { path, external: isOutside } of imports) {
      if (!isOutside || isBuiltin(path) || ["bun:sqlite", "<runtime>"].includes(path) || !isExternal(path)) continue
      const name = path
        .split("/")
        .slice(0, path.startsWith("@") ? 2 : 1)
        .join("/")
      if (!installed.has(name)) problems.push(`${input} imports ${path}, which is not a dependency of this package`)
    }
  }
  if (problems.length > 0) return { problems: [...new Set(problems)], chunks: [] }

  if (options.merge) {
    await mergeChunks(split, out, Object.keys(entryPoints), options.merge)
    rmSync(split, { recursive: true, force: true })
  }
  // A CLI imports an entry late too (`import("@wirecat/cli-core/mcp")`), so a server loads entries as well as chunks.
  // A bin would run, and an entry in `quiet` acts when imported.
  const skipped = new Set(
    [...Object.keys(options.entries ?? {}), ...(options.quiet ?? [])].map((name) => `${name}.js`).concat("preload.js"),
  )
  const chunks = readdirSync(out)
    .filter((file) => file.endsWith(".js") && !skipped.has(file))
    .sort()
    .map((file) => `./${file}`)
  writeFileSync(join(out, "chunks.json"), `${JSON.stringify(chunks, null, 2)}\n`)
  if (manifest.exports?.[PRELOAD] !== undefined) {
    writeFileSync(join(out, "preload.js"), preloadSource(chunks))
    writeFileSync(
      join(out, "preload.d.ts"),
      "/** Loads every chunk and entry of this package, for a server that outlives an upgrade. */\nexport declare const preload: () => Promise<void>\n",
    )
  }
  return { problems: [], chunks }
}
