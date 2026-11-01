import type { VocabularyFlag } from "./vocabulary.js"

export const MAIL_FLAGS: VocabularyFlag[] = [
  {
    name: "--cc",
    value: "<address>",
    role: "value",
    type: "string",
    meaning: "an e-mail address that gets a copy; repeat it for more",
  },
  {
    name: "--bcc",
    value: "<address>",
    role: "value",
    type: "string",
    meaning: "an e-mail address that gets a blind copy; repeat it for more",
  },
  {
    name: "--reply-all",
    role: "value",
    type: "switch",
    meaning: "with --reply-to, an e-mail reply also goes to everyone the message went to",
  },
]
