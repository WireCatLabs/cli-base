import * as v from "valibot"
import { CALENDAR_FLAGS } from "./flags-calendar.js"
import { HOW_FLAGS } from "./flags-how.js"
import { MAIL_FLAGS } from "./flags-mail.js"
import { WHAT_FLAGS } from "./flags-what.js"
import { duplicates, parseRegistry, text, word } from "./registry.js"

export const FLAG_TYPES = [
  "switch",
  "count",
  "number",
  "string",
  "id",
  "time",
  "duration",
  "choice",
  "list",
  "path",
  "cursor",
] as const

/**
 * What a flag does to a command. There is no `filter`: a list filters with its query, so a flag that filters has no
 * role and `option-role` reports it.
 */
export const FLAG_ROLES = {
  paging: "which part of a long answer: how many, which page, where to continue",
  output: "how the answer is shaped or shown",
  sort: "the order of the answer",
  mode: "how the command runs, not what it reads",
  action: "does something extra besides the answer",
  budget: "how much time or work the command may spend",
  scope: "which accounts, providers or sources are read; never picked for you, so a flag and not a query field",
  target: "which thing or time window the command acts on, when that is not a list's filter",
  value: "sets a field on a write",
  query: "a query in the query language, beside a search's own words",
} as const
export type FlagRole = keyof typeof FLAG_ROLES

const verbSchema = v.strictObject({ word, meaning: text, replaces: v.optional(v.array(word)) })
const nounSchema = v.strictObject({
  word,
  meaning: text,
  // A collection is named in the plural; a singular is what a profile has exactly one of.
  kind: v.picklist(["collection", "singular"]),
  replaces: v.optional(v.array(word)),
})
const viewSchema = v.strictObject({ word, meaning: text })
const rootSchema = v.strictObject({ word, meaning: text })
const flagSchema = v.strictObject({
  name: v.pipe(v.string(), v.regex(/^--[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "a long flag: --lower-case-words")),
  value: v.optional(v.pipe(v.string(), v.regex(/^<[a-z][a-z0-9-|=:]*(\.\.\.)?>$/, "a value name such as <n>"))),
  type: v.picklist(FLAG_TYPES),
  role: v.picklist(Object.keys(FLAG_ROLES) as [FlagRole, ...FlagRole[]]),
  meaning: text,
  unit: v.optional(text),
  /** Other names for the same flag, which `flag-synonym` refuses. */
  replaces: v.optional(v.array(v.pipe(v.string(), v.regex(/^--[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "a long flag")))),
})

export const vocabularySchema = v.strictObject({
  verbs: v.array(verbSchema),
  nouns: v.array(nounSchema),
  views: v.array(viewSchema),
  roots: v.array(rootSchema),
  flags: v.array(flagSchema),
})

export type Vocabulary = v.InferOutput<typeof vocabularySchema>
export type VocabularyVerb = Vocabulary["verbs"][number]
export type VocabularyNoun = Vocabulary["nouns"][number]
export type VocabularyFlag = Vocabulary["flags"][number]
export type FlagType = (typeof FLAG_TYPES)[number]

/** One word, one meaning within its kind: a second entry for the same verb, noun, view, root or flag is refused. */
export const defineVocabulary = (input: unknown): Vocabulary =>
  parseRegistry("vocabulary", vocabularySchema, input, (vocabulary) => {
    const problems: string[] = []
    const kinds = {
      verbs: vocabulary.verbs.map((entry) => entry.word),
      nouns: vocabulary.nouns.map((entry) => entry.word),
      views: vocabulary.views.map((entry) => entry.word),
      roots: vocabulary.roots.map((entry) => entry.word),
      flags: vocabulary.flags.map((entry) => entry.name),
    }
    for (const [kind, words] of Object.entries(kinds))
      for (const repeated of duplicates(words)) problems.push(`${kind}: "${repeated}" is listed twice`)
    for (const flag of vocabulary.flags)
      if ((flag.type === "switch") !== (flag.value === undefined))
        problems.push(`flags: ${flag.name} — a switch has no value name; every other type has one`)
    const verbs = new Set(kinds.verbs)
    for (const verb of vocabulary.verbs)
      for (const old of verb.replaces ?? [])
        if (verbs.has(old)) problems.push(`verbs: "${verb.word}" replaces "${old}", which is itself a verb`)
    const flags = new Set(kinds.flags)
    for (const flag of vocabulary.flags)
      for (const old of flag.replaces ?? [])
        if (flags.has(old)) problems.push(`flags: ${flag.name} replaces ${old}, which is itself a flag`)
    return problems
  })

const verbs: [string, string][] = [
  ["list", "show many"],
  ["show", "show one"],
  ["search", "find by text; the description says where it looks"],
  ["prepare", "assemble bounded cited context for a selected upcoming activity without applying findings"],
  ["related", "what is nearest in meaning to one thing, without a query"],
  ["info", "facts about a singular thing itself: where it is, its size, its version, its schema"],
  ["status", "how a thing stands right now"],
  ["check", "verify, and change nothing; the answer says what is wrong and how to fix it"],
  ["test", "run rules over what is already stored and say what they would have done, doing none of it"],
  ["apply", "run the owner's saved rules over what is already stored and change what they match; dry run unless --yes"],
  ["scan", "read stored messages for what a rule finds, such as tasks, and list it; records it only with --yes"],
  ["pause", "stop what a running process does for a profile, without stopping the process"],
  ["resume", "restart what pause stopped"],
  ["create", "make a thing"],
  ["delete", "destroy a thing"],
  ["add", "put an existing thing into a set"],
  ["remove", "take a thing out of a set"],
  ["clear", "empty a set"],
  ["update", "change a thing's fields"],
  ["set", "set one named key"],
  ["unset", "remove one named key"],
  ["insert", "put bounded rows, columns or cells before an explicit position, shifting later entries"],
  ["format", "change how selected cells are displayed without replacing their values"],
  ["rename", "change a thing's name only"],
  ["start", "start a running process, or a login session"],
  ["stop", "stop a running process"],
  ["restart", "stop and start a running process"],
  ["serve", "run a server in this process and answer its clients until stopped"],
  ["end", "end a login session"],
  ["revoke", "take back what was granted, so it stops working: a login, an invite link, a consent"],
  ["install", "install a system unit"],
  ["uninstall", "remove a system unit"],
  ["cancel", "stop a job or a pending thing"],
  [
    "sync",
    "bring the local store up to date from the source: only what changed, or the whole list where the source cannot say; a mirror syncs both ways",
  ],
  ["fetch", "one bounded pull of one named thing into the store, not a catch-up"],
  ["unsync", "stop syncing a thing; what the store already holds stays"],
  ["export", "write from the store to a file"],
  ["import", "bring a file or list the user gives into the store or the messenger, once"],
  ["download", "save a file from the source to this machine"],
  ["transcribe", "turn speech into text"],
  ["extract", "read the text inside files already on this machine into the store"],
  ["migrate", "bring a file up to this build's schema"],
  ["backup", "copy a file somewhere safe"],
  ["restore", "put a backup back in its place"],
  ["repair", "bring a file's tables to this build's shape without deleting anything"],
  [
    "rebuild",
    "compute again, from what the store already holds, what the tool derives from it, keeping the owner's decisions",
  ],
  // Only when someone asks, never from a matching name: WC-ACCT-11 in docs/standards/accounts.md.
  ["link", "record that two identities are one person"],
  ["unlink", "undo a link"],
  ["lookup", "ask the messenger who is behind a phone number"],
  [
    "inspect",
    "look at a source before taking anything from it: a chat link without joining, a mailbox without importing",
  ],
  ["send", "send a message"],
  ["edit", "change a sent message"],
  ["forward", "send an existing message on to another chat"],
  ["pin", "pin a message or chat"],
  ["unpin", "unpin a message or chat"],
  ["star", "mark a message so the owner finds it again; only the owner sees the star"],
  ["unstar", "take the owner's star off a message"],
  ["vote", "answer a poll"],
  ["answer", "reply to a button someone pressed under a bot's message"],
  ["respond", "answer an invitation: accept, tentatively accept or decline it"],
  ["press", "press a button under a bot's message; the bot sees who pressed it"],
  ["action", "show what a bot is doing in a chat, such as typing, for a few seconds"],
  ["watch", "follow new events as they come, and keep them"],
  ["close", "close a thing that stays: a poll, a task"],
  ["join", "join a chat"],
  ["leave", "leave a chat"],
  ["mute", "stop notifications from a chat for the owner; nobody in it is told"],
  ["unmute", "undo a mute"],
  ["block", "block a person"],
  ["unblock", "unblock a person"],
  ["mark-read", "mark a chat read; the other person sees it"],
  ["mark-unread", "mark a chat unread on the owner's own devices; nobody in it is told"],
  ["archive", "move a chat into the messenger's archive, out of the main chat list; nobody in it is told"],
  ["unarchive", "bring an archived chat back to the main chat list"],
  ["reset", "replace a thing; the old one stops working"],
  ["moderate", "apply a chat's rules: delete what breaks them, act on who broke them"],
  ["assign", "name the person responsible for work, with their task role"],
  ["reverse", "record that an accepted decision no longer holds, without replacing it"],
  ["invalidate", "mark a derived record whose supporting evidence no longer holds"],
  ["acknowledge", "record successful delivery using the exact receipt issued when the item was claimed"],
  ["confirm", "the owner accepts what an agent proposed"],
  ["reject", "the owner refuses what an agent proposed"],
  ["review", "list what waits for the owner's decision"],
  ["resolve", "settle one thing that waits for the owner's decision, with the owner's choice"],
  ["move", "move a thing to another place in the source: a file to a folder, an event to a calendar"],
  ["copy", "copy a file in the source"],
  ["run", "run a saved job once, now, as its timer would"],
  ["claim", "take a thing for a while so no other agent works it at once; the claim lapses by itself"],
  ["release", "give back what claim took, before it lapses"],
  ["merge", "fold a duplicate into the thing that stays; nothing is deleted"],
  ["unmerge", "undo a merge"],
  ["defer", "leave a decision undecided, for the owner"],
  ["embed", "compute the vectors a meaning search reads, for what is stored and has none"],
  ["decrypt", "write an unencrypted copy of a file sealed by the tool, using the supplied password"],
  ["retry", "start a fresh attempt at partial or failed work, retaining the previous attempt"],
]

const replaces: Record<string, string[]> = {
  list: ["ls"],
  show: ["get", "view"],
  search: ["find", "query"],
  delete: ["rm", "trash"],
  create: ["mkdir"],
  update: ["plan"],
  set: ["configure"],
  sync: ["refresh"],
  check: ["audit", "preflight"],
  status: ["readiness"],
  confirm: ["accept", "approve"],
  reject: ["decline", "deny"],
}

const collections: [string, string][] = [
  ["chats", "conversations in a messenger"],
  ["contacts", "identities in a messenger's contact list"],
  ["messages", "posts in a messenger chat, or emails"],
  ["drafts", "e-mails saved in a mailbox's Drafts folder, written and not sent"],
  ["polls", "polls in a chat"],
  ["reactions", "reactions to a message"],
  ["recipients", "who a message goes to"],
  ["replies", "the automatic replies of a profile"],
  ["sends", "messages waiting to be sent, or sent by this tool"],
  ["runs", "past runs of this tool"],
  ["topics", "forum topics in a group"],
  ["models", "local or remote models"],
  ["tags", "labels the owner puts on things"],
  ["searches", "the owner's saved searches"],
  ["copies", "tables kept aside by a repair"],
  ["tables", "the tables of the local store, with their kind, row count and size"],
  ["attachments", "files of stored messages"],
  ["tasks", "what waits on the owner"],
  ["members", "people in a chat"],
  ["admins", "administrators of a chat"],
  ["tracking", "the chats whose member lists are fetched daily"],
  ["documents", "files imported from Google Drive or Docs, or linked in a chat"],
  ["notes", "text the owner writes, or files from a notes folder"],
  ["projects", "the owner's work units with a task key"],
  [
    "annotations",
    "derived records attached to a selected entity, with explicit coverage of included and omitted facets",
  ],
  ["organizations", "companies, teams, families or communities"],
  [
    "identities",
    "ways to reach a person or an organization: an account in one messenger or mailbox, an e-mail address, a phone",
  ],
  ["facts", "what happened, with evidence"],
  ["memories", "what an agent concluded, with evidence and scope"],
  ["relationships", "confirmed or suggested links between people, organizations and projects"],
  ["sheets", "remote spreadsheets and their cell ranges, read or changed through a provider"],
  ["files", "files in the source, such as Google Drive, read and changed there"],
  ["comments", "comments people left on a thing in the source: a channel post or a file"],
  ["meetings", "stored meetings, from Zoom or another provider"],
  ["calendars", "calendars of an account, each synced or not"],
  ["events", "calendar entries: meetings, appointments and other things on a calendar"],
  ["people", "persons the owner deals with, such as the attendees of events"],
  ["recordings", "the files a provider recorded of a meeting"],
  ["jobs", "work this tool runs in the background or on a timer"],
  ["actions", "what an agent proposes to do; the owner confirms or rejects each"],
  ["agents", "the agents whose actions are recorded in the shared store"],
  ["reminders", "scheduled notices about stored work, claimed and acknowledged with delivery receipts"],
  ["key-documents", "selected source documents that a project keeps as its starting references"],
  ["answers", "evidence-grounded answers assembled from selected stored sources"],
  ["aliases", "other names of one thing"],
  ["mentions", "phones, e-mail addresses, links and documents found in stored text, each where it was written"],
  ["images", "pictures in stored messages, searched by what they show"],
  ["duplicates", "pairs of things that may be one, each waiting for a decision"],
  ["sessions", "devices and applications signed in to an account"],
  ["folders", "named groupings of chats or source files"],
  ["links", "stored or source-provided connections between selected things"],
  ["requests", "requests waiting for an explicit decision"],
  ["rules", "saved rules the owner applies to selected things"],
  ["conversations", "derived stretches of chat messages grouped by topic"],
  ["batches", "bounded work packets submitted or waiting for processing"],
  ["consents", "recorded permission to process selected data with a specified service"],
  ["embeddings", "vectors computed from stored content for similarity search"],
  ["reports", "saved reports about selected data or a tool's state"],
  ["keys", "credentials for a selected external service"],
  ["counters", "stored observations of source counts, with their freshness"],
  ["gaps", "ranges a source could contain that the local store does not hold"],
  ["callbacks", "button presses a bot received and may answer"],
  ["webhooks", "addresses a messenger pushes a bot's updates to"],
  ["templates", "messages a business has approved in advance, the only kind some messengers deliver late"],
  ["media", "files people sent, held by the messenger under an id"],
]

const singulars: [string, string][] = [
  ["session", "this tool's login"],
  ["account", "the messenger or mail account behind a profile"],
  ["mail", "the local email archive and its mailbox import, rules and cleanup operations"],
  ["config", "a profile's settings"],
  ["server", "the long-running process of a profile"],
  ["store", "the local SQLite database the tools share"],
  ["catalog", "stored source file and folder metadata and parent relationships"],
  ["skill", "the agent skill file of this tool"],
  ["cache", "max's per-profile cache"],
  ["flood", "what the messenger told this profile to hold off on"],
  ["vocabulary", "the owner's catalogue of canonical names, with their aliases"],
  ["api", "the source's own API, one command per operation"],
  ["privacy", "who may find, see, call or add the account"],
  ["metadata", "a profile's cached source attributes"],
  ["auth", "the credentials a bot profile uses: its token and the secrets beside it"],
]

const views: [string, string][] = [
  ["tree", "the parent and child hierarchy of stored sources"],
  ["logs", "the log of a running process"],
  ["events", "what happened in a thing over time"],
  ["scheduled", "what is scheduled to happen"],
  ["context", "what surrounds one thing"],
  ["path", "where a thing is on this machine"],
  ["config", "the configuration a thing needs"],
  ["history", "past uses of a thing"],
  ["top", "a ranked view under stats"],
  ["official", "the view the messenger itself computed, under stats"],
  ["transcript", "the text of speech: a voice message or a meeting recording"],
  ["evidence", "the stored messages or lines a result or a reference rests on"],
  ["passage", "a cited transcript line with bounded surrounding lines from the same revision"],
  ["agenda", "what needs a look today"],
  ["busy", "when calendars or people are taken, without what takes them"],
  ["categories", "the categories a thing takes, with what each means"],
  ["domains", "the internet domains links point to, most linked first"],
  ["places", "the street addresses confirmed as places, most mentioned first"],
  ["comments", "replies attached to a selected source item"],
  ["links", "links held for a selected thing"],
  ["voters", "people whose recorded votes are visible for a selected poll"],
  ["charts", "time series drawn from selected statistics, optionally rendered to a file"],
  ["newcomers", "members observed joining during the selected time window"],
  ["retention", "whether members of a selected cohort remain or return over time"],
  ["responses", "observed replies between participants and the time taken to answer"],
  ["discussion", "source posts compared by known views and observed discussion replies"],
  ["unanswered", "questions without an observed qualifying answer"],
  ["me", "the account a profile's token belongs to"],
  ["between", "the messages between two given messages of one chat"],
  ["app", "a bot's mini app: the address that opens it, signed in as the owner"],
]

const roots: [string, string][] = [
  ["batch", "run bounded explicitly registered reads with independent correlated answers"],
  ["inbox", "what waits across every chat"],
  ["review", "go through what needs the owner"],
  ["watch", "follow new events as they come"],
  ["serve", "the long-running process"],
  ["setup", "the guided first run: log in or link the account, then install the agent skill"],
  ["doctor", "check this machine's setup"],
  ["upgrade", "install a newer version of this tool"],
  ["commands", "the command tree as data"],
  ["guide", "scenarios: the commands for a common task, in order, and why each"],
  ["complete", "shell completion"],
  ["mcp", "the MCP server and its setup"],
  ["bot", "the profile's bot account"],
  ["stats", "statistics"],
  ["search", "searches across resources"],
]

/** The words every CLI on cli-base is judged against. Seeded from STANDARD's command-name rules and the glossary. */
export const VOCABULARY: Vocabulary = defineVocabulary({
  verbs: verbs.map(([entry, meaning]) => ({
    word: entry,
    meaning,
    ...(replaces[entry] ? { replaces: replaces[entry] } : {}),
  })),
  nouns: [
    ...collections.map(([entry, meaning]) => ({ word: entry, meaning, kind: "collection" })),
    ...singulars.map(([entry, meaning]) => ({ word: entry, meaning, kind: "singular" })),
  ],
  views: views.map(([entry, meaning]) => ({ word: entry, meaning })),
  roots: roots.map(([entry, meaning]) => ({ word: entry, meaning })),
  flags: [...HOW_FLAGS, ...WHAT_FLAGS, ...CALENDAR_FLAGS, ...MAIL_FLAGS],
})
