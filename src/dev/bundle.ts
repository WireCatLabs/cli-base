/**
 * `cli-dev bundle`: the published bin starts from an esbuild bundle of `dist/`, so a command loads a few dozen files
 * instead of about a thousand. Moved from tg-cli's `scripts/bundle.ts`, where it was proven first.
 *
 * - `dist/bundle/` holds the bundle. Its chunks keep every lazy `import()` lazy.
 * - The bin becomes a loader: it answers `--version`, turns the compile cache on before any of the bundle compiles,
 *   and for a server preloads every chunk so an in-place upgrade cannot pull one from under it.
 * - cli-core, cli-base and cli-core's peers stay outside when the installed cli-core is pre-bundled: the bundle holds
 *   only the CLI's code, and every CLI on one cli-core version shares that version's files. Outside, each is one
 *   package folder, so the process has one instance of each (cli-core checks `instanceof CliError` and
 *   `instanceof Command`). An unbundled cli-core, or `privateCore`, keeps the earlier mode: everything inside.
 * - A module moved into a chunk would look for files and packages from the chunk. In the CLI's own modules and in the
 *   anchored packages (cli-core and cli-base when they are inside), `import.meta.url` becomes the module's own place,
 *   and a package they load at run time is resolved from there too: pnpm installs cli-core's dependencies beside
 *   cli-core, not beside the CLI.
 * - The build fails when a bundled module would still look in the wrong place.
 * - A CLI with no `exports` drops tsc's `.d.ts` and `.map` files from `dist/`: nothing imports it, and no map is read
 *   for the bundle a user runs. A package with `exports` keeps them for whoever imports it.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
  /** Bundle cli-core and cli-base inside, as before cli-base 1.2, even when the installed cli-core is pre-bundled. */
  privateCore?: boolean
}

export interface BundleResult {
  problems: string[]
  /** The chunks a server preloads, as the loader names them. */
  chunks: string[]
  /** The packages left outside to be shared, empty when cli-core and cli-base are inside. */
  shared: string[]
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

export const DEFAULT_ANCHORED: readonly string[] = []

/** Anchored when they are bundled inside: an unbundled cli-core, or `privateCore`. */
export const CORE_PACKAGES = ["@wirecat/cli-core", "@wirecat/cli-base"]

// commander and @colors name these in comments and messages; liquidjs resolves partials with explicit `paths`, so the
// requiring file does not matter.
export const DEFAULT_HARMLESS = [
  "/commander/lib/command.js",
  "/@colors/colors/lib/colors.js",
  "/liquidjs/dist/liquid.node.js",
]

export const LOADER_MARK = "// cli-dev bundle loader\n"

const posix = (path: string) => path.split(sep).join("/")

export const matcher = (patterns: readonly string[]) => {
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
// As esbuild prints them: a pre-bundled package's chunks import natives this way.
const STATIC = /^import\s+(?:([^"';]*?)\s*from\s*)?(["'])([^"'.][^"']*)\2;?[ \t]*$/gm

/** `import a, { b as c } from "x"` as statements that take the names from `from`, a loaded module. */
const bindings = (names: string, from: string): string[] => {
  const statements: string[] = []
  let rest = names.trim()
  const first = rest.match(/^([\w$]+)\s*(?:,\s*|$)/)
  if (first) {
    statements.push(`const ${first[1]} = ${from}.default`)
    rest = rest.slice(first[0].length)
  }
  const namespace = rest.match(/^\*\s*as\s+([\w$]+)$/)
  if (namespace) statements.push(`const ${namespace[1]} = ${from}`)
  const named = rest.match(/^\{([^}]*)\}$/)
  if (named) statements.push(`const { ${(named[1] ?? "").replaceAll(/\s+as\s+/g, ": ")} } = ${from}`)
  return statements
}

export interface OwnPlacesOptions {
  /** The modules under it keep their place: `import.meta.url` becomes their file before bundling. */
  dist: string
  /** Where the bundle is written: the places are relative to it. */
  out: string
  /** Packages whose modules keep their installed place too. */
  anchored?: readonly string[]
  /** Third-party files that may look themselves up (a path suffix each); `DEFAULT_HARMLESS` when not given. */
  harmless?: readonly string[]
  /** What stays outside the bundle; a run-time import of it resolves from the module's own place. */
  isExternal?: (specifier: string) => boolean
  /** Outside packages imported as written, so every module gets the one copy the CLI installed. */
  isShared?: (specifier: string) => boolean
  /** Collects each module that would look for a file or package in the wrong place. */
  problems: string[]
}

/** The esbuild plugin that keeps each module's place (the header says why). */
export const ownPlaces = ({
  dist,
  out,
  anchored = [],
  harmless = DEFAULT_HARMLESS,
  isExternal = () => false,
  isShared = () => false,
  problems,
}: OwnPlacesOptions): Plugin => {
  const loadsLate = (specifier: string) => isExternal(specifier) && !isShared(specifier)
  // `bun:sqlite` has no place to resolve from.
  const staticLate = (specifier: string) => loadsLate(specifier) && !specifier.includes(":")
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
        // Only an anchored package's static imports: the CLI's own resolve from the bundle, which is the CLI's place.
        const own = args.path.startsWith(dist + sep)
        const loadsOutside =
          [...source.matchAll(LITERAL)].some(([, , specifier]) => specifier && loadsLate(specifier)) ||
          (!own && [...source.matchAll(STATIC)].some(([, , , specifier]) => specifier && staticLate(specifier)))
        if (!source.includes("import.meta") && source.search(BY_NAME) < 0 && !loadsOutside) return undefined
        const other = source.match(/import\.meta\.(?!url\b|resolve\b)\w+/)
        if (other) problems.push(`${args.path}: ${other[0]}`)
        let loaded = 0
        // `place` holds `import.meta.url` or `import.meta.resolve`, so it goes in last.
        const contents = source
          .replaceAll(STATIC, (statement, names: string | undefined, quote, specifier) => {
            if (own || !staticLate(specifier)) return statement
            const from = `importFrom(PLACE, ${quote}${specifier}${quote})`
            if (!names) return `await ${from};`
            const name = `__outside${loaded++}`
            return [`const ${name} = await ${from}`, ...bindings(names, name)].join(";\n")
          })
          .replaceAll(/import\.meta\.resolve\(/g, "resolveFrom(PLACE, ")
          .replaceAll(BY_NAME, "importFrom(PLACE, ")
          .replaceAll(LITERAL, (call, quote, specifier) =>
            loadsLate(specifier) ? `importFrom(PLACE, ${quote}${specifier}${quote})` : call,
          )
          .replaceAll(/import\.meta\.url\b/g, "PLACE")
          .replaceAll(/\bPLACE\b/g, place)
          // A pre-bundled package's banner may use the name this bundle's banner declares.
          .replaceAll(/\b__bundleRequire\b/g, own ? "__bundleRequire" : "__anchoredRequire")
        // The bin's `#!` must stay the first line.
        const [, hashbang = "", body = contents] = contents.match(/^(#![^\n]*\n)?([\s\S]*)$/) ?? []
        return { contents: `${hashbang}import { importFrom, resolveFrom } from "${FROM}";\n${body}`, loader: "js" }
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
export const commonJsNames: Plugin = {
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

/**
 * `upgrade`: the package manager replaces the files this process runs from, and pnpm deletes the old folder, so a chunk
 * the command imports after the install is gone (MODULE_NOT_FOUND). It loads every chunk before it starts.
 */
export const isUpgrade = (words: readonly string[]): boolean =>
  words
    .filter((word) => !word.startsWith("-"))
    .slice(0, 2)
    .includes("upgrade")

/**
 * The bin that replaces the compiled one: `name` is the bundle's entry, `chunks` what a server preloads, `preloads` the
 * shared packages whose own chunks it preloads too, through their `./preload` export, which also resolves imports
 * between those chunks without looking on disk.
 */
export const loaderSource = (
  name: string,
  version: string,
  chunks: readonly string[],
  preloads: readonly string[] = [],
): string => {
  const shared = preloads.length > 0
  return `#!/usr/bin/env node
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
  const chunks = ${JSON.stringify(chunks)}
${
  shared
    ? `  const preload = () =>
    Promise.allSettled([
      ...chunks.map((chunk) => import(chunk)),
      ...${JSON.stringify(preloads.map((name) => `${name}/preload`))}.map((name) => import(name).then((loaded) => loaded.preload())),
    ])
  if ((${isUpgrade.toString()})(words)) await preload()`
    : `  if ((${isUpgrade.toString()})(words)) await Promise.allSettled(chunks.map((chunk) => import(chunk)))`
}
  const running = import(${JSON.stringify(`../bundle/${name}.js`)})
  // After the server answers its first request, so it starts no later.
  if (serves) setTimeout(() => void ${shared ? "preload()" : "Promise.allSettled(chunks.map((chunk) => import(chunk)))"}, 2000).unref()
  await running
}
`
}

interface Manifest {
  version?: string
  exports?: unknown
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const readManifest = (file: string): Manifest | undefined =>
  existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Manifest) : undefined

const exportOf = (manifest: Manifest, key: string): unknown =>
  typeof manifest.exports === "object" && manifest.exports !== null
    ? (manifest.exports as Record<string, unknown>)[key]
    : undefined

/** Whether a package's root export is a bundle, as `bundlePackage` builds one. */
const isPreBundled = (manifest: Manifest): boolean => {
  const root = exportOf(manifest, ".")
  const entry = typeof root === "string" ? root : (root as { default?: unknown } | undefined)?.default
  return typeof entry === "string" && entry.startsWith("./dist/bundle/")
}

const packageName = (specifier: string) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/")

// A range would let the installed version differ from the one the CLI was built and tested against.
const EXACT = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/

export const bundle = async (options: BundleOptions): Promise<BundleResult> => {
  const { build } = await import("esbuild")
  const root = options.root
  const dist = join(root, "dist")
  const out = join(dist, "bundle")
  const bin = join(root, options.bin)
  const name = basename(bin).replace(/\.[cm]?js$/, "")
  const problems: string[] = []

  if (!bin.startsWith(dist + sep)) return { problems: [`${options.bin} is not under dist/`], chunks: [], shared: [] }
  if (readFileSync(bin, "utf8").includes(LOADER_MARK))
    return { problems: [`${options.bin} is already the loader — compile it again (tsc) first`], chunks: [], shared: [] }
  const manifest = readManifest(join(root, "package.json")) ?? {}
  const installed = (name: string) => readManifest(join(root, "node_modules", name, "package.json"))

  // cli-core brings its peers; a CLI on cli-base alone brings cli-base's.
  const host = installed("@wirecat/cli-core") ?? installed("@wirecat/cli-base")
  const sharing = !options.privateCore && host !== undefined && isPreBundled(host)
  const shared = sharing ? [...new Set([...CORE_PACKAGES, ...Object.keys(host.peerDependencies ?? {})])] : []
  const isShared = matcher(shared.flatMap((name) => [name, `${name}/*`]))
  const external = [...DEFAULT_EXTERNAL, ...shared.flatMap((name) => [name, `${name}/*`]), ...(options.external ?? [])]
  const isExternal = matcher(external)
  const declared = { ...manifest.peerDependencies, ...manifest.optionalDependencies, ...manifest.dependencies }
  for (const core of CORE_PACKAGES) {
    const range = manifest.dependencies?.[core]
    if (sharing && range !== undefined && !EXACT.test(range))
      problems.push(
        `${core} is "${range}" in dependencies: pin it exactly, since the bundle runs the installed version`,
      )
  }
  if (problems.length > 0) return { problems, chunks: [], shared }

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
      ownPlaces({
        dist,
        out,
        anchored: [...DEFAULT_ANCHORED, ...(sharing ? [] : CORE_PACKAGES), ...(options.anchored ?? [])],
        harmless: [...DEFAULT_HARMLESS, ...(options.harmless ?? [])],
        isExternal,
        isShared,
        problems,
      }),
    ],
    metafile: true,
    logLevel: "silent",
  })
  // Only the CLI's own modules may import a package that stays outside: it resolves from the bundle, the CLI's place.
  // A shared package is the exception: from the bundle it is the CLI's copy, the one every module must get.
  const own = `${posix(relative(root, dist))}/`
  for (const [input, { imports }] of Object.entries(metafile.inputs)) {
    for (const name of shared) {
      if (input.includes(`node_modules/${name}/`))
        problems.push(`${input} is a copy of ${name} in the bundle; it must load from the installed package`)
    }
    if (input.startsWith(own)) continue
    for (const { path, external: outside } of imports) {
      if (outside && !isShared(path) && !isBuiltin(path) && !["bun:sqlite", "<runtime>"].includes(path))
        problems.push(`${input} imports ${path}, which would resolve from the bundle`)
    }
  }
  for (const { imports } of Object.values(metafile.outputs)) {
    for (const { path, external: outside } of imports) {
      if (outside && isShared(path) && declared[packageName(path)] === undefined)
        problems.push(
          `the bundle imports ${path}, but ${packageName(path)} is not in dependencies, so no install has it`,
        )
    }
  }
  if (problems.length > 0) return { problems: [...new Set(problems)], chunks: [], shared }

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
  if (missing.length > 0)
    return { problems: missing.map((chunk) => `the loader names ${chunk}, not built`), chunks, shared }
  const preloads = shared.filter((name) => {
    const installedManifest = installed(name)
    return installedManifest !== undefined && exportOf(installedManifest, "./preload") !== undefined
  })
  writeFileSync(bin, loaderSource(name, manifest.version ?? "", chunks, preloads))
  if (manifest.exports === undefined) {
    for (const file of readdirSync(dist, { recursive: true, encoding: "utf8" }))
      if (/\.js\.map$|\.d\.ts(\.map)?$/.test(file)) rmSync(join(dist, file))
  }
  return { problems: [], chunks, shared }
}
