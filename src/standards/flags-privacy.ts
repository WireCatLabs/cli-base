import type { VocabularyFlag } from "./vocabulary.js"

/** Who may see or reach the account, as a messenger's privacy settings take it. */
export const PRIVACY_FLAGS: VocabularyFlag[] = [
  {
    name: "--about-text",
    value: "<who>",
    role: "value",
    type: "choice",
    meaning: "who sees the about text: everyone, contacts or nobody",
  },
  {
    name: "--calls",
    value: "<who>",
    role: "value",
    type: "choice",
    meaning: "whose calls ring: everyone, contacts or nobody",
  },
  {
    name: "--chat-invites",
    value: "<who>",
    role: "value",
    type: "choice",
    meaning: "who may add the account to groups and channels: everyone, contacts or nobody",
  },
  {
    name: "--find-by-phone",
    value: "<who>",
    role: "value",
    type: "choice",
    meaning: "who finds the account by its number: everyone, contacts or nobody",
  },
  {
    name: "--hide-online",
    value: "<on|off>",
    role: "value",
    type: "choice",
    meaning: "hide online status and last seen",
  },
  {
    name: "--last-seen",
    value: "<who>",
    role: "value",
    type: "choice",
    meaning: "who sees when the account was last online: everyone, contacts or nobody",
  },
  {
    name: "--phone-number",
    value: "<who>",
    role: "value",
    type: "choice",
    meaning: "who sees the number: everyone, contacts or nobody",
  },
  {
    name: "--profile-photo",
    value: "<who>",
    role: "value",
    type: "choice",
    meaning: "who sees the profile photo: everyone, contacts or nobody",
  },
  { name: "--read-receipts", value: "<on|off>", role: "value", type: "choice", meaning: "send read receipts" },
]
