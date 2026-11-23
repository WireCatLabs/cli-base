import type { VocabularyFlag } from "./vocabulary.js"

/** Work items: memo's tasks, and a tracker's issues. */
export const WORK_FLAGS: VocabularyFlag[] = [
  {
    name: "--assignee",
    value: "<person...>",
    role: "value",
    type: "list",
    otherValues: ["user"],
    meaning: "who does it: people by UID (<person...>), or one tracker user by id, name or e-mail (<user>)",
  },
  {
    name: "--priority",
    value: "<n>",
    role: "value",
    type: "string",
    meaning: "how urgent: low, medium, high, critical or none, a score from 0.0 to 1.0, or the old 0 urgent … 4 low",
  },
  {
    name: "--team",
    value: "<team>",
    role: "value",
    type: "string",
    meaning: "the tracker team that owns an issue, by id, key or name",
  },
]
