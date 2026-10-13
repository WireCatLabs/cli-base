import * as v from "valibot"
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
  value: v.optional(v.pipe(v.string(), v.regex(/^<[a-z][a-z0-9-|]*>$/, "a value name such as <n>"))),
  type: v.picklist(FLAG_TYPES),
  meaning: text,
  unit: v.optional(text),
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
    return problems
  })

const verbs: [string, string][] = [
  ["list", "show many"],
  ["show", "show one"],
  ["search", "find by text; the description says where it looks"],
  ["related", "what is nearest in meaning to one thing, without a query"],
  ["info", "facts about a singular thing itself: where it is, its size, its version, its schema"],
  ["status", "how a thing stands right now"],
  ["check", "verify, and change nothing; the answer says what is wrong and how to fix it"],
  ["test", "run rules over what is already stored and say what they would have done, doing none of it"],
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
  ["rename", "change a thing's name only"],
  ["start", "start a running process, or a login session"],
  ["stop", "stop a running process"],
  ["restart", "stop and start a running process"],
  ["end", "end a login session"],
  ["install", "install a system unit"],
  ["uninstall", "remove a system unit"],
  ["cancel", "stop a job or a pending thing"],
  [
    "sync",
    "bring the local store up to date from the source: only what changed, or the whole list where the source cannot say",
  ],
  ["fetch", "one bounded pull of one named thing into the store, not a catch-up"],
  ["export", "write from the store to a file"],
  ["import", "bring a file or list the user gives into the store or the messenger, once"],
  ["download", "save a file from the source to this machine"],
  ["transcribe", "turn speech into text"],
  ["extract", "read the text inside files already on this machine into the store"],
  ["migrate", "bring a file up to this build's schema"],
  ["backup", "copy a file somewhere safe"],
  ["restore", "put a backup back in its place"],
  ["repair", "bring a file's tables to this build's shape without deleting anything"],
  ["link", "record that two identities are one person"],
  ["unlink", "undo a link"],
  ["lookup", "ask the messenger who is behind a phone number"],
  ["inspect", "look at a link without joining it"],
  ["send", "send a message"],
  ["edit", "change a sent message"],
  ["forward", "send an existing message on to another chat"],
  ["pin", "pin a message or chat"],
  ["unpin", "unpin a message or chat"],
  ["vote", "answer a poll"],
  ["close", "close a thing that stays: a poll, a task"],
  ["join", "join a chat"],
  ["leave", "leave a chat"],
  ["block", "block a person"],
  ["unblock", "unblock a person"],
  ["mark-read", "mark a chat read; the other person sees it"],
  ["reset", "replace a thing; the old one stops working"],
  ["moderate", "apply a chat's rules: delete what breaks them, act on who broke them"],
  ["confirm", "the owner accepts what an agent proposed"],
  ["reject", "the owner refuses what an agent proposed"],
  ["move", "move a file in the source"],
  ["copy", "copy a file in the source"],
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
  ["attachments", "files of stored messages"],
  ["tasks", "what waits on the owner"],
  ["members", "people in a chat"],
  ["admins", "administrators of a chat"],
  ["tracking", "the chats whose member lists are fetched daily"],
  ["documents", "files imported from Google Drive or Docs, or linked in a chat"],
  ["notes", "text the owner writes, or files from a notes folder"],
  ["projects", "the owner's work units with a task key"],
  ["organizations", "companies, teams, families or communities"],
  ["identities", "accounts of a person in one messenger or mailbox"],
  ["facts", "what happened, with evidence"],
  ["memories", "what an agent concluded, with evidence and scope"],
  ["relationships", "confirmed or suggested links between people, organizations and projects"],
]

const singulars: [string, string][] = [
  ["session", "this tool's login"],
  ["account", "the messenger or mail account behind a profile"],
  ["config", "a profile's settings"],
  ["server", "the long-running process of a profile"],
  ["store", "the local SQLite database the tools share"],
  ["skill", "the agent skill file of this tool"],
  ["cache", "max's per-profile cache"],
  ["flood", "what the messenger told this profile to hold off on"],
]

const views: [string, string][] = [
  ["logs", "the log of a running process"],
  ["events", "what happened in a thing over time"],
  ["scheduled", "what is scheduled to happen"],
  ["context", "what surrounds one thing"],
  ["path", "where a thing is on this machine"],
  ["config", "the configuration a thing needs"],
  ["history", "past uses of a thing"],
  ["top", "a ranked view under stats"],
  ["official", "the view the messenger itself computed, under stats"],
]

const roots: [string, string][] = [
  ["inbox", "what waits across every chat"],
  ["review", "go through what needs the owner"],
  ["watch", "follow new events as they come"],
  ["serve", "the long-running process"],
  ["doctor", "check this machine's setup"],
  ["upgrade", "install a newer version of this tool"],
  ["commands", "the command tree as data"],
  ["complete", "shell completion"],
  ["mcp", "the MCP server and its setup"],
  ["bot", "the profile's bot account"],
  ["stats", "statistics"],
  ["search", "searches across resources"],
]

const flags: Vocabulary["flags"] = [
  { name: "--limit", value: "<n>", type: "count", meaning: "how many items", unit: "items" },
  { name: "--page", value: "<n>", type: "count", meaning: "which page, from 1, where the source has no cursor" },
  {
    name: "--page-size",
    value: "<n>",
    type: "count",
    meaning: "how many items one request to the source asks for",
    unit: "items",
  },
  { name: "--cursor", value: "<cursor>", type: "cursor", meaning: "continue from where the previous page ended" },
  { name: "--before-id", value: "<id>", type: "id", meaning: "read what came before this message id" },
  { name: "--after-id", value: "<id>", type: "id", meaning: "read what came after this message id" },
  { name: "--before-time", value: "<time>", type: "time", meaning: "read what came before this time" },
  { name: "--after-time", value: "<time>", type: "time", meaning: "read what came after this time" },
  { name: "--since-time", value: "<time>", type: "time", meaning: "only what came since this time" },
  { name: "--at-time", value: "<time>", type: "time", meaning: "do it at this time" },
  { name: "--before-n", value: "<n>", type: "count", meaning: "how many messages before it", unit: "messages" },
  { name: "--after-n", value: "<n>", type: "count", meaning: "how many messages after it", unit: "messages" },
  { name: "--timeout", value: "<duration>", type: "duration", meaning: "give up after this long" },
  { name: "--dry-run", type: "switch", meaning: "judge and plan; do nothing" },
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
  flags,
})
