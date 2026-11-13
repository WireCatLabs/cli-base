/**
 * `contracts/wirecat.json`, format 2: what a CLI tells WireCat Desktop about itself, built from its command tree so
 * nothing in it is typed by hand except the tagline and the sign-in texts. Desktop reads it out of the npm tarball
 * without running the package, so every array holds plain words only: the same rule as Desktop's `community.rs`.
 */
import * as v from "valibot"
import { type CommandInfo, flatten, type OptionInfo, summaryOf } from "../commands/registry.js"
import { HOST_PATTERN } from "../http/hosts.js"
import { effectsSchema } from "../standards/effects.js"
import { issuesOf, jsonSchemaOf, SNAKE_CASE } from "../standards/registry.js"
import type { WcatTool } from "./describe.js"
import { PROGRAM_PREFIX, TOOL_NAME } from "./names.js"

export const MANIFEST_FORMAT = 2
export const MANIFEST_FILE = "contracts/wirecat.json"

/**
 * Hosts every CLI may reach through the shared packages rather than its own code: npm for the update check, Hugging
 * Face for the models search, speech and pictures use, GitHub releases for the ONNX runtime and the speech detector,
 * and the hosts both redirect their files to. `cli-dev manifest` adds them to the hosts a CLI declares.
 */
export const SHARED_HOSTS: readonly string[] = [
  "registry.npmjs.org",
  "huggingface.co",
  "*.huggingface.co",
  "*.hf.co",
  "github.com",
  "*.githubusercontent.com",
]

/** Desktop's `plain_word`: letters, digits and `._:=,/+@-`, at most two leading dashes, `--` alone, `{name}` slots. */
export const PLAIN_WORD = /^(?:--|-{0,2}(?:[A-Za-z0-9]|\{[A-Za-z]+\})(?:[A-Za-z0-9._:=,/+@-]|\{[A-Za-z]+\})*)$/

const plainWord = v.pipe(
  v.string(),
  v.maxLength(100, "a command word is at most 100 characters"),
  v.regex(
    PLAIN_WORD,
    (issue) =>
      `${JSON.stringify(issue.input)} is not a plain word: letters, digits and ._:=,/+@-, at most two leading dashes, -- alone and {name} slots; no spaces, quotes or shell syntax`,
  ),
)
const words = v.pipe(v.array(plainWord), v.minLength(1))
const line = (max: number) => v.pipe(v.string(), v.regex(/^\S(?:[^\n\r]*\S)?$/, "one line of text"), v.maxLength(max))

const signInSchema = v.strictObject({
  /** What signing in lets the agent do, in a sentence: "Lets your agent read your Acme contacts." */
  gives: line(300),
  /** What the person is asked for: "An Acme API token, from Settings → API." */
  asks: line(300),
})

export type SignIn = v.InferOutput<typeof signInSchema>

/** Exactly the keys of a Desktop catalog entry that the tool itself knows; `null` when unused. */
const desktopSchema = v.strictObject({
  tagline: line(55),
  profiles: v.nullable(v.strictObject({ args: words, shape: v.literal("items") })),
  doctor: words,
  runs: v.nullable(v.strictObject({ list: words, show: words })),
  search: v.null(),
  setup: v.nullable(words),
  signIn: v.nullable(signInSchema),
  skill: v.nullable(v.strictObject({ status: words, install: words, show: words })),
  /** Desktop gives an own tool a free port of its own and fills `{port}`. */
  mcpServer: v.nullable(
    v.strictObject({
      start: words,
      stop: words,
      status: words,
      revoke: words,
      config: v.nullable(words),
    }),
  ),
  tasks: v.null(),
  sync: v.nullable(
    v.strictObject({
      run: words,
      last: v.nullable(words),
      lastShape: v.literal("runs"),
      what: line(40),
      note: v.null(),
    }),
  ),
  storeInfo: v.null(),
  storeTables: v.null(),
  storeTableSizes: v.null(),
  storeCheck: v.null(),
  storeBackup: v.null(),
  storeBackupEncrypted: v.null(),
  storeResetPreview: v.null(),
  storeReset: v.null(),
  storage: v.strictObject({
    app: v.pipe(v.string(), v.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "a folder name")),
    env: v.pipe(v.string(), v.regex(/^[A-Z][A-Z0-9_]*$/, "an upper-case environment prefix")),
  }),
  settings: v.null(),
})

export type ManifestDesktop = v.InferOutput<typeof desktopSchema>

const hostSchema = v.pipe(
  v.string(),
  v.maxLength(253),
  v.regex(
    HOST_PATTERN,
    (issue) =>
      `${JSON.stringify(issue.input)} is not a host: a lower-case hostname with no scheme, port or path, or one leading *. before two labels or more`,
  ),
)

const networkSchema = v.strictObject({
  /** Every host the CLI contacts; `[]` says it contacts none. */
  hosts: v.array(hostSchema),
  /** Hosts the person chooses, in words: "the mail server you sign in to". */
  user_hosts: v.optional(line(120)),
})

const entityName = v.pipe(v.string(), v.regex(SNAKE_CASE, "a snake_case entity name"))

export const manifestSchema = v.strictObject({
  wcat_manifest: v.literal(MANIFEST_FORMAT),
  name: v.pipe(v.string(), v.regex(TOOL_NAME, "lower-case letters, digits and -")),
  description: line(200),
  docs_url: v.optional(v.pipe(v.string(), v.url(), v.startsWith("https://", "an https link"))),
  package: v.pipe(v.string(), v.regex(/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/, "a scoped npm package name")),
  bin: v.pipe(v.string(), v.regex(TOOL_NAME, "lower-case letters, digits and -")),
  commands: v.array(
    v.strictObject({
      path: words,
      /** The command's one-line help; left out when it has none. */
      summary: v.optional(line(300)),
      effects: effectsSchema,
      /** The permission key cli-core checks this command against; left out for housekeeping or when not given. */
      permission: v.optional(v.pipe(v.string(), v.nonEmpty())),
      /** What it answers with: its output entity, else its query's. */
      entity: v.optional(entityName),
    }),
  ),
  /** The keys cli-base knows of each entity, from the queries over it; an entity with no query is not listed. */
  entities: v.optional(v.record(entityName, v.strictObject({ fields: v.pipe(v.array(entityName), v.minLength(1)) }))),
  /** Left out when the identity declares no `hosts`: the CLI did not say, which Desktop flags. */
  network: v.optional(networkSchema),
  desktop: desktopSchema,
})

export type Manifest = v.InferOutput<typeof manifestSchema>

export const manifestJsonSchema = () => jsonSchemaOf(manifestSchema)

/**
 * What a CLI declares for its manifest: its `wcatStart` argument plus cli-core's `AppIdentity` folders, the tagline
 * and the sign-in texts. `{ ...IDENTITY, docs, tagline, signIn }` builds it from cli-core's identity.
 */
export interface ManifestIdentity extends WcatTool {
  /** The data folder name: cli-core's `AppIdentity.appName`. */
  appName: string
  /** The environment prefix: cli-core's `AppIdentity.envPrefix`. */
  envPrefix: string
  /** At most 55 characters: Desktop's Tools page line. */
  tagline?: string
  signIn?: SignIn
  /** What `sync` copies, at most 40 characters: "contacts and deals". Required when the CLI has a sync command. */
  syncs?: string
  /**
   * Every host the CLI contacts, as `hostFetch` checks them: `["api.acme.example", "*.cdn.acme.example"]`; `[]` for
   * none. Written to the manifest as `network.hosts`.
   */
  hosts?: readonly string[]
  /** Hosts the person chooses, at most 120 characters: "the mail server you sign in to". Needs `hosts`. */
  userHosts?: string
  /** The permission key of a command path, such as cli-core's `CommandPermissions.keyOf`; `null` for none. */
  permissionOf?: (path: readonly string[]) => string | null
}

export interface ManifestPackage {
  name?: unknown
  bin?: unknown
}

export interface ManifestInput {
  identity: ManifestIdentity
  /** `describeProgram(createProgram())`. */
  commands: readonly CommandInfo[]
  /** The CLI's `package.json`. */
  pkg: ManifestPackage
  /** Whether the package ships a `skills/` folder. */
  skills: boolean
}

export class ManifestError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`${MANIFEST_FILE} cannot be built: ${problems.join("; ")}`)
    this.name = "ManifestError"
  }
}

const UNDECLARED = { remote: "write", local: "write" } as const

const binOf = (pkg: ManifestPackage, command: string): string => {
  if (typeof pkg.bin === "string" && typeof pkg.name === "string") return pkg.name.replace(/^@[^/]+\//, "")
  const names = typeof pkg.bin === "object" && pkg.bin !== null ? Object.keys(pkg.bin) : []
  const found = [`${PROGRAM_PREFIX}${command}`, command].find((name) => names.includes(name))
  if (!found)
    throw new ManifestError([`package.json "bin" installs neither ${PROGRAM_PREFIX}${command} nor ${command}`])
  return found
}

export const buildManifest = ({ identity, commands, pkg, skills }: ManifestInput): Manifest => {
  const all = flatten(commands)
  const at = new Map(all.map((command) => [command.path.join(" "), command]))
  const has = (...paths: string[]) => paths.every((path) => at.has(path))
  const optionOf = (path: string, flag: string): OptionInfo | undefined =>
    at.get(path)?.options.find((option) => option.flags.split(/[ ,|]+/).includes(flag))
  const takes = (path: string, flag: string) => optionOf(path, flag) !== undefined
  const allProfiles = (path: string) => (takes(path, "--profiles") ? ["--profiles", "all"] : [])

  const profileList = ["account list", "session list"].find((path) => at.has(path))
  const profiles = profileList ? { args: [...profileList.split(" "), "--no-record", "--json"], shape: "items" } : null
  const profile = profiles ? ["{profile}"] : []

  if (!has("doctor")) throw new ManifestError(["no doctor command: Desktop checks every tool with it"])
  if (!identity.tagline)
    throw new ManifestError(["no tagline: add `tagline`, at most 55 characters, to the identity the manifest reads"])

  const setupPath = ["setup", "session start"].find((path) => at.has(path))
  const mcpServer = has("mcp server start", "mcp server stop", "mcp server status", "mcp revoke")
    ? {
        start: [
          "mcp",
          "server",
          "start",
          "--port",
          "{port}",
          ...(takes("mcp server start", "--public-url") ? ["--public-url", "{url}"] : []),
          ...allProfiles("mcp server start"),
          "--json",
        ],
        stop: ["mcp", "server", "stop", ...allProfiles("mcp server stop"), "--json"],
        status: ["mcp", "server", "status", ...allProfiles("mcp server status"), "--no-record", "--json"],
        revoke: ["mcp", "revoke", ...allProfiles("mcp revoke"), "--json"],
        config: has("mcp config") ? ["mcp", "config", ...allProfiles("mcp config"), "--no-record", "--json"] : null,
      }
    : null

  const nounSyncs = all.filter((command) => command.path.length === 2 && command.path[1] === "sync")
  const syncPath = at.get("sync")?.path ?? (nounSyncs.length === 1 ? nounSyncs[0]?.path : undefined)
  if (syncPath && !identity.syncs)
    throw new ManifestError([
      `no syncs: \`${syncPath.join(" ")}\` exists, so add \`syncs\`, what it copies in at most 40 characters`,
    ])
  // `runs list` matches `command:` exactly and a plain word holds no space, so only a one-word path can be found.
  const last =
    syncPath?.length === 1 && has("runs list")
      ? ["runs", "list", "command:sync", "status:success", "--limit", "50", "--no-record", "--json"]
      : null
  const sync = syncPath
    ? {
        run: [...profile, ...syncPath, "--record", "--json"],
        last,
        lastShape: "runs",
        what: identity.syncs,
        note: null,
      }
    : null

  const twice = identity.hosts?.filter((host, index) => identity.hosts?.indexOf(host) !== index) ?? []
  if (twice.length > 0) throw new ManifestError(twice.map((host) => `hosts: ${host} is listed twice`))
  if (identity.userHosts && !identity.hosts)
    throw new ManifestError(["userHosts needs hosts: list the fixed hosts the CLI contacts, [] when there are none"])
  const runs = all.filter((command) => command.commands.length === 0 || command.runnable)
  const fields = new Map<string, Set<string>>()
  for (const { query } of all)
    if (query) {
      const known = fields.get(query.entity) ?? new Set<string>()
      for (const field of query.fields) if (field.relation === undefined) known.add(field.name)
      if (known.size > 0) fields.set(query.entity, known)
    }

  const manifest = {
    wcat_manifest: MANIFEST_FORMAT,
    name: identity.command,
    description: identity.description,
    ...(identity.docs ? { docs_url: identity.docs } : {}),
    package: pkg.name,
    bin: binOf(pkg, identity.command),
    commands: runs.map((command) => {
      const permission = identity.permissionOf?.(command.path)
      const summary = summaryOf(command)
      const entity = command.output?.entity ?? command.query?.entity
      return {
        path: [...command.path],
        ...(summary ? { summary } : {}),
        effects: command.effects ?? UNDECLARED,
        ...(permission ? { permission } : {}),
        ...(entity ? { entity } : {}),
      }
    }),
    ...(fields.size > 0
      ? { entities: Object.fromEntries([...fields].map(([name, known]) => [name, { fields: [...known] }])) }
      : {}),
    ...(identity.hosts
      ? {
          network: {
            hosts: [...new Set([...identity.hosts, ...SHARED_HOSTS])],
            ...(identity.userHosts ? { user_hosts: identity.userHosts } : {}),
          },
        }
      : {}),
    desktop: {
      tagline: identity.tagline,
      profiles,
      doctor: [...profile, "doctor", "--record", "--json"],
      runs: has("runs list", "runs show")
        ? {
            list: ["runs", "list", "{query}", "--limit", "{limit}", "--page", "{page}", "--no-record", "--json"],
            show: ["runs", "show", "{run}", "--no-record", "--json"],
          }
        : null,
      search: null,
      setup: setupPath ? [...profile, ...setupPath.split(" ")] : null,
      signIn: identity.signIn ? { gives: identity.signIn.gives, asks: identity.signIn.asks } : null,
      skill:
        skills && has("skill status", "skill install", "skill show")
          ? {
              status: ["skill", "status", "--no-record", "--json"],
              install: ["skill", "install", "--for", "{target}", "--json"],
              show: ["skill", "show", "--no-record", "--json"],
            }
          : null,
      mcpServer,
      tasks: null,
      sync,
      storeInfo: null,
      storeTables: null,
      storeTableSizes: null,
      storeCheck: null,
      storeBackup: null,
      storeBackupEncrypted: null,
      storeResetPreview: null,
      storeReset: null,
      storage: { app: identity.appName, env: identity.envPrefix },
      settings: null,
    },
  }
  const parsed = v.safeParse(manifestSchema, manifest)
  if (!parsed.success) throw new ManifestError(issuesOf(parsed.issues))
  return parsed.output
}

/** The bytes `cli-dev manifest` writes, so `--check` is a byte compare and the shipped hash is stable. */
export const manifestText = (manifest: Manifest): string => `${JSON.stringify(manifest, null, 2)}\n`
