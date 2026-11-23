import type { VocabularyFlag } from "./vocabulary.js"

/** Posts and pages on a site or blog the owner publishes, and pages in a workspace such as Notion. */
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
  {
    name: "--from-template",
    value: "<template>",
    role: "value",
    type: "string",
    meaning: "start the new page from one of the source's page templates, by name or id; not a message --template",
  },
  {
    name: "--cover",
    value: "<link>",
    role: "value",
    type: "string",
    meaning: "the page's cover image, by an https link, or none to take it away; a local image file is --photo",
  },
  {
    name: "--allow-deleting-content",
    role: "mode",
    type: "switch",
    meaning:
      "let an update delete the child pages and databases its new text leaves out; the source keeps them in its " +
      "trash, unlike --allow-delete",
  },
]
