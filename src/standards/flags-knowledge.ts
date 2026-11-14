import type { VocabularyFlag } from "./vocabulary.js"

/** Memories and facts that rest on cited sources, sources the owner adds by hand, and the owner's labels. */
export const KNOWLEDGE_FLAGS: VocabularyFlag[] = [
  {
    name: "--accept-terms",
    role: "mode",
    type: "switch",
    meaning: "no longer needed; kept so older scripts still run",
  },
  {
    name: "--quote",
    value: "<ref=words...>",
    role: "value",
    type: "list",
    meaning: "the words an --evidence reference says that a record rests on, as <ref>=<words>, one per reference",
  },
  {
    name: "--suggest",
    value: "<text>",
    role: "value",
    type: "string",
    meaning: "wording offered for the owner to take or leave; it decides nothing",
  },
  {
    name: "--keep-copy",
    role: "mode",
    type: "switch",
    meaning: "keep a copy of the original file as well as its text",
  },
  {
    name: "--max-chars",
    value: "<n>",
    role: "budget",
    type: "count",
    meaning: "at most this many characters read",
    unit: "characters",
  },
  {
    name: "--tag",
    value: "<name>",
    role: "target",
    type: "string",
    meaning: "a tag, by its name or an alias: only what carries it is read",
  },
  {
    name: "--matching",
    value: "<query>",
    role: "target",
    type: "string",
    meaning: "every stored thing a search with this query finds, in its query language; the command acts on each",
  },
]
