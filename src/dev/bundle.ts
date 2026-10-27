/**
 * `cli-dev bundle`: the published bin starts from an esbuild bundle of `dist/`, so a command loads a few dozen files
 * instead of about a thousand. Moved from tg-cli's `scripts/bundle.ts`, where it was proven first.
 *
 * - `dist/bundle/` holds the bundle. Its chunks keep every lazy `import()` lazy.
 * - The bin becomes a loader: it answers `--version`, turns the compile cache on before any of the bundle compiles,
 *   and for a server preloads every chunk so an in-place upgrade cannot pull one from under it.
 * - A module moved into a chunk would look for files and packages from the chunk. In the CLI's own modules and in the
 *   anchored packages (cli-core, cli-base), `import.meta.url` becomes the module's own place, and a package they load
 *   at run time is resolved from there too: pnpm installs cli-core's dependencies beside cli-core, not beside the CLI.
 * - The build fails when a bundled module would still look in the wrong place.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { isBuiltin } from "node:module"
import { basename, dirname, join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"
import type { Plugin } from "esbuild"

export interface BundleOptions {
  /** The CLI's root: `dist/` and `package.json` are under it. */
  root: string
  /** The compiled bin, relative to `root`, e.g. `dist/bin/tg.js`. It becomes the loader. */
  bin: string
  /** Packages that stay outside the bundle, besides `DEFAULT_EXTERNAL`. `*` matches anything. */
  external?: readonly string[]
  /** Packages whose modules keep their installed place, besides `DEFAULT_ANCHORED`. */
  anchored?: readonly string[]
  /** Third-party files read and found harmless, besides `DEFAULT_HARMLESS` (a path suffix each). */
  harmless?: readonly string[]
}

export interface BundleResult {
  problems: string[]
  /** The chunks a server preloads, as the loader names them. */
  chunks: string[]
}

/** Native modules, Bun's SQLite, and what cli-core loads only by name or starts as a worker from its own file. */
export const DEFAULT_EXTERNAL = [
  "bun:sqlite",
  "*.node",
  "better-sqlite3",
  "@napi-rs/*",
  "@resvg/*",
  "@huggingface/*",
  "sherpa-onnx*",
  "onnxruntime-*",
  "@wirecat/cli-core-onnx",
  "@wirecat/cli-core-sqlite",
  "ogg-opus-decoder",
]

export const DEFAULT_ANCHORED = ["@wirecat/cli-core", "@wirecat/cli-base"]

// commander and @colors name these in comments and messages; liquidjs resolves partials with explicit `paths`, so the
// requiring file does not matter.
export const DEFAULT_HARMLESS = [
  "/commander/lib/command.js",
  "/@colors/colors/lib/colors.js",
  "/liquidjs/dist/liquid.node.js",
]

export const LOADER_MARK = "// cli-dev bundle loader\n"

const posix = (path: string) => path.split(sep).join("/")

const matcher = (patterns: readonly string[]) => {
  const expressions = patterns.map((pattern) => new RegExp(`^${pattern.replaceAll(".", "\\.").replaceAll("*", ".*")}$`))
  return (specifier: string) => expressions.some((expression) => expression.test(specifier))
}

// Node has no "resolve from this parent" call; a resolve hook for the one call gives Node's own answer. Bun has no
// hooks but has `Bun.resolveSync(specifier, parent)`; when it finds nothing, the plain lookup keeps Bun's own error.
const FROM = "cli-dev-bundle:from"
const FROM_SOURCE = `import * as module from "node:module"
import { dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
export const resolveFrom = (parent, specifier) => {
  if (globalThis.Bun) {
    if (specifier.includes(":")) return import.meta.resolve(specifier)
    try {
      return pathToFileURL(globalThis.Bun.resolveSync(specifier, dirname(fileURLToPath(parent)))).href
    } catch {
      return import.meta.resolve(specifier)
    }
  }
  if (!module.registerHooks) return import.meta.resolve(specifier)
  const hooks = module.registerHooks({
    resolve: (asked, context, next) => next(asked, asked === specifier ? { ...context, parentURL: parent } : context),
  })
  try {
    return import.meta.resolve(specifier)
  } finally {
    hooks.deregister()
  }
}
export const importFrom = async (parent, specifier) => import(resolveFrom(parent, specifier))
`

const BY_NAME = /(?<![\w$.])import\(\s*(?!["'`.])/g
const LITERAL = /(?<![\w$.])import\(\s*(["'])([^"'.][^"']*)\1\s*\)/g

const ownPlaces = (
  dist: string,
  out: string,
  anchored: readonly string[],
  harmless: readonly string[],
  isExternal: (specifier: string) => boolean,
  problems: string[],
): Plugin => {
  const placeOf = (file: string): string | undefined => {
    if (file.startsWith(dist + sep))
      return `new URL(${JSON.stringify(posix(relative(out, file)))}, import.meta.url).href`
    for (const name of anchored) {
      const marker = `${sep}node_modules${sep}${name.replace("/", sep)}${sep}`
      const at = file.lastIndexOf(marker)
      if (at < 0) continue
      const packageRoot = file.slice(0, at + marker.length)
      const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
      const entry = manifest.exports?.["."]?.default
      if (typeof entry !== "string") throw new Error(`${name}: package.json has no exports["."].default to anchor on`)
      const path = posix(relative(dirname(join(packageRoot, entry)), file))
      return `new URL(${JSON.stringify(path)}, import.meta.resolve(${JSON.stringify(name)})).href`
    }
    return undefined
  }
  return {
    name: "own-places",
    setup(context) {
      context.onResolve({ filter: new RegExp(`^${FROM}$`) }, () => ({ path: FROM, namespace: FROM }))
      context.onLoad({ filter: /.*/, namespace: FROM }, () => ({ contents: FROM_SOURCE, loader: "js" }))
      context.onLoad({ filter: /\.[cm]?js$/ }, (args) => {
        const source = readFileSync(args.path, "utf8")
        const place = placeOf(args.path)
        if (!place) {
          const known = harmless.some((path) => posix(args.path).endsWith(path))
          if (!known && /import\.meta|__dirname|__filename|require\.resolve/.test(source)) problems.push(args.path)
          return undefined
        }
        const loadsOutside = [...source.matchAll(LITERAL)].some(([, , specifier]) => specifier && isExternal(specifier))
        if (!source.includes("import.meta") && source.search(BY_NAME) < 0 && !loadsOutside) return undefined
        const other = source.match(/import\.meta\.(?!url\b|resolve\b)\w+/)
        if (other) problems.push(`${args.path}: ${other[0]}`)
        // `place` holds `import.meta.url` or `import.meta.resolve`, so it goes in last.
        const contents = source
          .replaceAll(/import\.meta\.resolve\(/g, "resolveFrom(PLACE, ")
          .replaceAll(BY_NAME, "importFrom(PLACE, ")
          .replaceAll(LITERAL, (call, quote, specifier) =>
            isExternal(specifier) ? `importFrom(PLACE, ${quote}${specifier}${quote})` : call,
          )
          .replaceAll(/import\.meta\.url\b/g, "PLACE")
          .replaceAll(/\bPLACE\b/g, place)
        return { contents: `import { importFrom, resolveFrom } from "${FROM}";\n${contents}`, loader: "js" }
      })
    },
  }
}

const isCommonJs = (file: string): boolean => {
  if (file.endsWith(".cjs")) return true
  if (!file.endsWith(".js")) return false
  for (let directory = dirname(file); directory !== dirname(directory); directory = dirname(directory)) {
    const manifest = join(directory, "package.json")
    if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, "utf8")).type !== "module"
  }
  return true
}

/**
 * `await import("yaml")` gets CommonJS's named exports from Node, but only `default` from a bundled chunk. A dynamic
 * import of CommonJS goes through a module that exports the names Node itself finds in it.
 */
const commonJsNames: Plugin = {
  name: "common-js-names",
  setup(context) {
    context.onResolve({ filter: /.*/ }, async (args) => {
      if (args.kind !== "dynamic-import" || args.pluginData === "inner") return undefined
      const resolved = await context.resolve(args.path, {
        kind: "dynamic-import",
        importer: args.importer,
        resolveDir: args.resolveDir,
        pluginData: "inner",
      })
      if (resolved.errors.length > 0 || resolved.external || !isCommonJs(resolved.path)) return undefined
      return { path: resolved.path, namespace: "common-js-names" }
    })
    context.onLoad({ filter: /.*/, namespace: "common-js-names" }, async (args) => {
      const names = Object.keys(await import(pathToFileURL(args.path).href)).filter((name) => name !== "default")
      const values = names.map((name, index) => `const n${index} = cjs[${JSON.stringify(name)}]`)
      const exported = names.map((name, index) => `n${index} as ${JSON.stringify(name)}`)
      return {
        contents: `const cjs = require(${JSON.stringify(args.path)})\n${values.join("\n")}\nexport default cjs\nexport { ${exported.join(", ")} }\n`,
        resolveDir: dirname(args.path),
        loader: "js",
      }
    })
  },
}

/**
 * Whether the loader runs a server: `serve`, `watch` or `mcp serve`, or `mcp` alone as before cli-core 0.463. Flags
 * are skipped, so `<cli> personal --read-only mcp serve` counts; four words leave room for one flag's value. It is
 * written into the loader as source, so it uses nothing from outside.
 */
export const isServer = (words: readonly string[]): boolean => {
  const plain = words.filter((word) => !word.startsWith("-"))
  return plain
    .slice(0, 4)
    .some((word, at) => word === "serve" || word === "watch" || (word === "mcp" && plain[at + 1] === undefined))
}

/** The bin that replaces the compiled one: `name` is the bundle's entry, `chunks` what a server preloads. */
export const loaderSource = (name: string, version: string, chunks: readonly string[]): string => `#!/usr/bin/env node
${LOADER_MARK}import * as module from "node:module"

const words = process.argv.slice(2)
// As the CLI answers it, unless a test records the argv: then the CLI writes the record too.
if (
  words.length === 1 &&
  (words[0] === "--version" || words[0] === "-V") &&
  !Object.keys(process.env).some((key) => key.endsWith("_TEST_ARGV_LOG"))
) {
  process.stdout.write(${JSON.stringify(`${version}\n`)})
} else {
  // Before the bundle compiles: the bundle's own call comes after its chunks.
  module.enableCompileCache()
  const serves = (${isServer.toString()})(words)
  if (serves && module.registerHooks) {
    const bundle = new URL("../bundle/", import.meta.url).href
    module.registerHooks({
      resolve: (specifier, context, next) =>
        specifier.startsWith("./") && context.parentURL?.startsWith(bundle)
          ? { url: new URL(specifier, context.parentURL).href, format: "module", shortCircuit: true }
          : next(specifier, context),
    })
  }
  const running = import(${JSON.stringify(`../bundle/${name}.js`)})
  const chunks = ${JSON.stringify(chunks)}
  // After the server answers its first request, so it starts no later.
  if (serves) setTimeout(() => void Promise.allSettled(chunks.map((chunk) => import(chunk))), 2000).unref()
  await running
}
`

export const bundle = async (options: BundleOptions): Promise<BundleResult> => {
  const { build } = await import("esbuild")
  const root = options.root
  const dist = join(root, "dist")
  const out = join(dist, "bundle")
  const bin = join(root, options.bin)
  const name = basename(bin).replace(/\.[cm]?js$/, "")
  const external = [...DEFAULT_EXTERNAL, ...(options.external ?? [])]
  const isExternal = matcher(external)
  const problems: string[] = []

  if (!bin.startsWith(dist + sep)) return { problems: [`${options.bin} is not under dist/`], chunks: [] }
  if (readFileSync(bin, "utf8").includes(LOADER_MARK))
    return { problems: [`${options.bin} is already the loader — compile it again (tsc) first`], chunks: [] }
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }

  rmSync(out, { recursive: true, force: true })
  const { metafile } = await build({
    absWorkingDir: root,
    entryPoints: { [name]: bin },
    outdir: out,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node22",
    chunkNames: "[name]-[hash]",
    // Two modules with one name would otherwise become `name2`, and `name` reaches errors and `commands --json`.
    keepNames: true,
    external,
    // Bundled CommonJS calls `require` for Node's own modules.
    banner: {
      js: 'import { createRequire as __bundleRequire } from "node:module";\nconst require = __bundleRequire(import.meta.url);',
    },
    plugins: [
      commonJsNames,
      ownPlaces(
        dist,
        out,
        [...DEFAULT_ANCHORED, ...(options.anchored ?? [])],
        [...DEFAULT_HARMLESS, ...(options.harmless ?? [])],
        isExternal,
        problems,
      ),
    ],
    metafile: true,
    logLevel: "silent",
  })
  // Only the CLI's own modules may import a package that stays outside: it resolves from the bundle, the CLI's place.
  const own = `${posix(relative(root, dist))}/`
  for (const [input, { imports }] of Object.entries(metafile.inputs)) {
    if (input.startsWith(own)) continue
    for (const { path, external: outside } of imports) {
      if (outside && !isBuiltin(path) && !["bun:sqlite", "<runtime>"].includes(path))
        problems.push(`${input} imports ${path}, which would resolve from the bundle`)
    }
  }
  if (problems.length > 0) return { problems, chunks: [] }

  // An upgrade replaces the chunks under a running server, and their names carry a hash: a server that had not yet
  // loaded one would fail to find it. A server loads them all soon after it starts, and finds a chunk it holds without
  // looking on disk, where Node's resolver would look again for each new importer.
  const lazy = new Set<string>()
  for (const { imports } of Object.values(metafile.outputs)) {
    for (const { path, kind, external: outside } of imports) {
      if (kind === "dynamic-import" && !outside) lazy.add(`../bundle/${basename(path)}`)
    }
  }
  const chunks = [...lazy].sort()
  const missing = chunks.filter((chunk) => !existsSync(join(out, basename(chunk))))
  if (missing.length > 0) return { problems: missing.map((chunk) => `the loader names ${chunk}, not built`), chunks }
  writeFileSync(bin, loaderSource(name, version, chunks))
  return { problems: [], chunks }
}
