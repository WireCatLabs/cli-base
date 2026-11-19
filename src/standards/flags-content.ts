import type { VocabularyFlag } from "./vocabulary.js"

/** Posts and pages on a site or blog the owner publishes. */
export const CONTENT_FLAGS: VocabularyFlag[] = [
  { name: "--slug", value: "<slug>", role: "value", type: "string", meaning: "the last part of its web address" },
  {
    name: "--tags",
    value: "<ids>",
    role: "value",
    type: "list",
    meaning: "its tags and categories, by comma-separated ids; replaces the ones it has",
  },
  {
    name: "--replace-body",
    role: "mode",
    type: "switch",
    meaning: "write the new text over a body the tool cannot fully read back, losing what it could not show",
  },
]
