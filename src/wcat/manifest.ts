/**
 * `contracts/wirecat.json`, format 2: what a CLI tells WireCat Desktop about itself, built from its command tree so
 * nothing in it is typed by hand except the tagline and the sign-in texts. Desktop reads it out of the npm tarball
 * without running the package, so every array holds plain words only, the same rule as Desktop's `community.rs`, but
 * the one query in `sync.last` (`SYNC_QUERY`).
 */
import * as v from "valibot"
import { type CommandInfo, flatten, type OptionInfo, summaryOf } from "../commands/registry.js"
import { HOST_PATTERN } from "../http/hosts.js"
import { effectsSchema } from "../standards/effects.js"
import { issuesOf, jsonSchemaOf, SNAKE_CASE } from "../standards/registry.js"
import type { WcatTool } from "./describe.js"
import { PROGRAM_PREFIX, TOOL_NAME } from "./names.js"

/** @experimental */
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

/**
 * Desktop's `plain_word`: letters, digits and `._:=,/+@-`, at most two leading dashes, `--` alone, `{name}` slots.
 *
 * @experimental
 */
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

/**
 * The one word that is not plain: `runs list` matches `command:` exactly, so a `<noun> sync` is found only as the
 * quoted phrase, `command:"meetings sync" status:success`. Desktop runs it without a shell and accepts this form in
 * `sync.last` only.
 *
 * @experimental
 */
export const SYNC_QUERY = /^command:"[a-z0-9][a-z0-9-]*(?: [a-z0-9][a-z0-9-]*)+" status:success$/
const lastWords = v.pipe(v.array(v.union([plainWord, v.pipe(v.string(), v.regex(SYNC_QUERY))])), v.minLength(1))
const line = (max: number) => v.pipe(v.string(), v.regex(/^\S(?:[^\n\r]*\S)?$/, "one line of text"), v.maxLength(max))

/**
 * A sign-in Desktop runs in its own window: the words, whether the secret the person types is the command's whole
 * stdin, and for cli-core's application password sign-in the flags that take the site and the user name Desktop asks
 * for. The other flags and names say where Desktop passes what the person typed. Desktop takes them only from
 * WireCat's own tools, so a tool it did not build keeps to the words, `stdin`, `site` and `login`.
 */
const signInMethodSchema = v.strictObject({
  id: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,31}$/, "a lower-case method id")),
  /** The button or tab: "API token". */
  label: line(40),
  /** `{profile}` first, then the command: `["{profile}", "session", "start", "--json"]`. */
  words,
  stdin: v.optional(v.boolean()),
  site: v.optional(v.literal("--site")),
  login: v.optional(v.literal("--login")),
  /** The flag that takes a new profile's mail address. */
  address: v.optional(v.literal("--address")),
  /** The variable the CLI reads an app password or token from: a flag would show it in the process list. */
  password: v.optional(v.pipe(v.string(), v.regex(/^[A-Z][A-Z0-9_]*$/, "an upper-case variable name"))),
  /** The flag that takes the person's own OAuth client file, which Desktop writes to a private file for the run. */
  clientFile: v.optional(v.literal("--client-file")),
  /** The setting that names the person's own OAuth app, saved before the run: `microsoft_client_id`. */
  clientId: v.optional(v.pipe(v.string(), v.regex(SNAKE_CASE, "a snake_case setting name"))),
  /** The words that make a new profile sign in in the browser with the CLI's own app: `["--method", "oauth"]`. */
  oauth: v.optional(words),
  /** The flags for a local application: the portal it signs in to and its id. Its key goes on stdin. */
  portal: v.optional(v.literal("--portal")),
  appId: v.optional(v.literal("--client-id")),
})

const signInSchema = v.strictObject({
  /** What signing in lets the agent do, in a sentence: "Lets your agent read your Acme contacts." */
  gives: line(300),
  /** What the person is asked for: "An Acme API token, from Settings → API." */
  asks: line(300),
  /** Left out when the CLI signs in only at a terminal, so the manifest of every other CLI stays as it was. */
  methods: v.optional(v.pipe(v.array(signInMethodSchema), v.minLength(1))),
})

export type SignIn = v.InferOutput<typeof signInSchema>

/** The method keys Desktop refuses from a tool it did not build (wirecat-desktop docs/dev/cli-registry.md, rule 4). */
const OURS_ONLY = ["address", "password", "clientFile", "clientId", "oauth", "portal", "appId"] as const

const duration = v.pipe(v.string(), v.regex(/^[1-9][0-9]*[mh]$/, "minutes or hours: 15m, 1h"))

const scheduleSchema = v.strictObject({
  /** The interval a new timer starts with; one of `choices`. */
  every: duration,
  /** The intervals Desktop offers. */
  choices: v.pipe(v.array(duration), v.minLength(1)),
  /** The command the timer runs, without the profile: the schedule's environment names it. */
  args: words,
})

export type SyncSchedule = v.InferOutput<typeof scheduleSchema>

const desktopSignInSchema = v.strictObject({
  ...signInSchema.entries,
  /**
   * Desktop asks `setup show` only from this version on. The manifest ships inside the version it describes, so that
   * version always has the flow.
   */
  setupFrom: v.optional(v.literal("0.0.0")),
})

/** Exactly the keys of a Desktop catalog entry that the tool itself knows; `null` when unused. */
const desktopSchema = v.strictObject({
  tagline: line(55),
  profiles: v.nullable(v.strictObject({ args: words, shape: v.literal("items") })),
  doctor: words,
  runs: v.nullable(v.strictObject({ list: words, show: words })),
  search: v.null(),
  setup: v.nullable(words),
  signIn: v.nullable(desktopSignInSchema),
  skill: v.nullable(v.strictObject({ status: words, install: words, show: words })),
  /**
   * `port` is a WireCat tool's fixed port, from the identity's `mcpPort`. Desktop gives any other tool a free port of
   * its own and fills `{port}`. Left out, not `null`, without `mcpPort`, so the manifest of every other CLI stays as it
   * was.
   */
  mcpServer: v.nullable(
    v.strictObject({
      port: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1024), v.maxValue(65535))),
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
      last: v.nullable(lastWords),
      lastShape: v.literal("runs"),
      what: line(40),
      note: v.null(),
      /** Left out, not `null`, without the identity's `syncSchedule`, so the manifest of every other CLI stays as it was. */
      schedule: v.optional(scheduleSchema),
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
  /**
   * Removing one account: `session end` signs it out, cli-core's `account remove` forgets it. `removes` and `keeps`
   * say what the sign-out alone takes and leaves. Left out when the CLI has neither, like `meetings`.
   */
  accountRemove: v.optional(
    v.strictObject({
      signOut: v.nullable(words),
      remove: v.nullable(
        v.strictObject({
          minVersion: v.literal("0.0.0"),
          keepData: words,
          deleteData: words,
          dryRun: plainWord,
          confirm: plainWord,
        }),
      ),
      removes: v.array(v.literal("signIn")),
      keeps: v.array(v.picklist(["settings", "data", "listed"])),
    }),
  ),
  /**
   * How a client's call or a meeting this tool saved opens: Desktop finds the tool by `provider`. Left out, not `null`,
   * when the tool records none, because Desktop 0.6.8 and older refuse a manifest with a key they do not read.
   */
  meetings: v.optional(
    v.strictObject({
      provider: v.pipe(v.string(), v.regex(TOOL_NAME, "a provider name")),
      show: words,
      transcript: words,
    }),
  ),
})

/** @experimental */
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

/** @experimental */
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
   * cli-core's provider name on the meetings or calls this CLI saves (`MeetingSource.provider`): "beeline". Needs
   * `meetings show` and `meetings transcript`; Desktop opens a client's call with them.
   */
  meetingsProvider?: string
  /**
   * The sync Desktop runs, when the CLI has no root `sync` and several `<noun> sync` commands: the command and its
   * flags, without the profile: `["messages", "sync", "--all", "--timeout", "120m"]`. Without it such a CLI states no
   * sync. Needs `syncs`.
   */
  syncCommand?: readonly string[]
  /**
   * Desktop's timer for the sync, run through cli-core's `schedule command`: the interval a new timer starts with, the
   * intervals it offers, and the command when it differs from the sync's own (`args`, without the profile).
   */
  syncSchedule?: { every: string; choices: readonly string[]; args?: readonly string[] }
  /**
   * The fixed port of the CLI's MCP server in WireCat Desktop: 8765. Only WireCat's own tools set it, each a port no
   * other tool has; Desktop gives every other tool one of its own. Needs `mcp server start`, `stop`, `status` and
   * `mcp revoke`.
   */
  mcpPort?: number
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

/** @experimental */
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

  // Arguments may follow a command (`session start qr`), so the longest leading run of words that is one names it.
  const commandAt = (words: readonly string[]) => {
    for (let end = words.length; end > 0; end -= 1) {
      const command = at.get(words.slice(0, end).join(" "))
      if (command !== undefined && (command.commands.length === 0 || command.runnable === true)) return command
    }
    return undefined
  }
  const scheduleOf = (schedule: NonNullable<ManifestIdentity["syncSchedule"]>, run: readonly string[]) => {
    const lacks = ["schedule command", "schedule list", "schedule remove", "schedule run"].filter(
      (path) => !at.has(path),
    )
    if (lacks.length > 0)
      throw new ManifestError([
        `syncSchedule needs ${lacks.map((path) => `\`${path}\``).join(", ")}: Desktop runs them`,
      ])
    if (!schedule.choices.includes(schedule.every))
      throw new ManifestError([`syncSchedule: every ${schedule.every} is not one of its choices`])
    const args = [...(schedule.args ?? run)]
    if (commandAt(args) === undefined)
      throw new ManifestError([`syncSchedule: \`${args.join(" ")}\` names no command of this CLI`])
    return { every: schedule.every, choices: [...schedule.choices], args }
  }

  const setupPath = ["setup", "session start"].find((path) => at.has(path))
  const serves = has("mcp server start", "mcp server stop", "mcp server status", "mcp revoke")
  if (identity.mcpPort !== undefined && !serves)
    throw new ManifestError([
      "mcpPort needs `mcp server start`, `stop`, `status` and `mcp revoke`: Desktop runs the server with them",
    ])
  const mcpServer = serves
    ? {
        ...(identity.mcpPort !== undefined ? { port: identity.mcpPort } : {}),
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
  const named = identity.syncCommand ? commandAt(identity.syncCommand) : undefined
  if (identity.syncCommand && named === undefined)
    throw new ManifestError([`syncCommand: \`${identity.syncCommand.join(" ")}\` names no command of this CLI`])
  const syncPath = named?.path ?? at.get("sync")?.path ?? (nounSyncs.length === 1 ? nounSyncs[0]?.path : undefined)
  const syncWords = identity.syncCommand ?? syncPath ?? []
  if (syncPath && !identity.syncs)
    throw new ManifestError([
      `no syncs: \`${syncPath.join(" ")}\` exists, so add \`syncs\`, what it copies in at most 40 characters`,
    ])
  const query =
    syncPath?.length === 1 ? ["command:sync", "status:success"] : [`command:"${syncPath?.join(" ")}" status:success`]
  const last =
    syncPath && has("runs list") ? ["runs", "list", ...query, "--limit", "50", "--no-record", "--json"] : null
  const sync = syncPath
    ? {
        run: [...profile, ...syncWords, "--record", "--json"],
        last,
        lastShape: "runs",
        what: identity.syncs,
        note: null,
        ...(identity.syncSchedule ? { schedule: scheduleOf(identity.syncSchedule, syncWords) } : {}),
      }
    : null
  if (identity.syncSchedule && !sync) throw new ManifestError(["syncSchedule needs a sync command"])

  if (identity.meetingsProvider && !has("meetings show", "meetings transcript"))
    throw new ManifestError([
      "meetingsProvider needs `meetings show` and `meetings transcript`: Desktop opens a call with them",
    ])
  const meetings = identity.meetingsProvider
    ? {
        meetings: {
          provider: identity.meetingsProvider,
          show: [...profile, "meetings", "show", "{id}", "--no-record", "--json"],
          transcript: [...profile, "meetings", "transcript", "{id}", "--no-record", "--json"],
        },
      }
    : {}

  const signOut = profiles && has("session end") ? [...profile, "session", "end", "--record", "--json"] : null
  // `--yes` is a global flag of cli-core's programs, read with optsWithGlobals, so `account remove` does not list it.
  const remove =
    profiles && ["--keep-data", "--delete-data", "--dry-run"].every((flag) => takes("account remove", flag))
      ? {
          // The manifest ships inside the version it describes, so that version always has the command.
          minVersion: "0.0.0",
          keepData: [...profile, "account", "remove", "--keep-data", "--record", "--json"],
          deleteData: [...profile, "account", "remove", "--delete-data", "--record", "--json"],
          dryRun: "--dry-run",
          confirm: "--yes",
        }
      : null
  const accountRemove =
    signOut || remove
      ? {
          accountRemove: {
            signOut,
            remove,
            removes: signOut ? ["signIn"] : [],
            keeps: signOut ? ["settings", "data", "listed"] : [],
          },
        }
      : {}

  const methods = identity.signIn?.methods
  for (const method of methods ?? []) {
    const [first, ...rest] = method.words
    if (first !== "{profile}" || !profiles)
      throw new ManifestError([
        `signIn method ${method.id}: Desktop signs in a profile, so its words start with {profile}`,
      ])
    // Arguments may follow the command (`session start qr`), so any leading run of words that is a command will do.
    const runsAt = (end: number) => {
      const command = at.get(rest.slice(0, end + 1).join(" "))
      return command !== undefined && (command.commands.length === 0 || command.runnable === true)
    }
    const end = rest.findLastIndex((_, index) => runsAt(index))
    if (end < 0)
      throw new ManifestError([`signIn method ${method.id}: \`${rest.join(" ")}\` names no command of this CLI`])
    if (method.site || method.login) {
      if (!method.site || !method.login || method.stdin !== true)
        throw new ManifestError([`signIn method ${method.id}: site and login go together, with the password on stdin`])
      const path = rest.slice(0, end + 1).join(" ")
      const lacks = [method.site, method.login].filter((flag) => !takes(path, flag))
      if (lacks.length > 0)
        throw new ManifestError([`signIn method ${method.id}: \`${path}\` takes no ${lacks.join(" or ")}`])
    }
    const passed = OURS_ONLY.filter((key) => method[key] !== undefined)
    if (passed.length > 0 && !(typeof pkg.name === "string" && pkg.name.startsWith("@wirecat/")))
      throw new ManifestError([
        `signIn method ${method.id}: Desktop takes ${passed.join(", ")} only from WireCat's own @wirecat packages`,
      ])
    const path = rest.slice(0, end + 1).join(" ")
    const flags = [method.address, method.clientFile, method.portal, method.appId].filter((flag) => flag !== undefined)
    const missing = flags.filter((flag) => !takes(path, flag))
    if (missing.length > 0)
      throw new ManifestError([`signIn method ${method.id}: \`${path}\` takes no ${missing.join(" or ")}`])
    if (rest.some((word) => word.includes("{")))
      throw new ManifestError([`signIn method ${method.id}: {profile} is the only slot Desktop fills in a sign-in`])
  }

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
      signIn: identity.signIn
        ? {
            gives: identity.signIn.gives,
            asks: identity.signIn.asks,
            ...(methods ? { methods } : {}),
            ...(has("setup show", "setup apply", "setup run") ? { setupFrom: "0.0.0" } : {}),
          }
        : null,
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
      ...accountRemove,
      ...meetings,
    },
  }
  const parsed = v.safeParse(manifestSchema, manifest)
  if (!parsed.success) throw new ManifestError(issuesOf(parsed.issues))
  return parsed.output
}

/** The bytes `cli-dev manifest` writes, so `--check` is a byte compare and the shipped hash is stable. */
export const manifestText = (manifest: Manifest): string => `${JSON.stringify(manifest, null, 2)}\n`
