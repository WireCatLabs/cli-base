import type { VocabularyFlag } from "./vocabulary.js"

/** What a search by meaning reads besides its query. */
export const SEARCH_FLAGS: VocabularyFlag[] = [
  {
    name: "--like",
    value: "<text>",
    role: "query",
    type: "string",
    meaning:
      "a made-up example of the text sought, such as a reply that would answer the question, searched by meaning " +
      "beside the query",
  },
]
