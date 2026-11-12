import type { VocabularyFlag } from "./vocabulary.js"

/** The words cli-core's shared sign-in and account commands use in every CLI. */
export const ACCOUNT_FLAGS: VocabularyFlag[] = [
  {
    name: "--client-id",
    value: "<id>",
    role: "mode",
    type: "id",
    meaning: "sign in through the owner's own OAuth app with this client ID instead of WireCat's (WC-SECR-25)",
  },
  {
    name: "--client-file",
    value: "<file>",
    role: "mode",
    type: "path",
    meaning: "sign in through the owner's own OAuth app read from this client JSON instead of WireCat's (WC-SECR-25)",
  },
  {
    name: "--keep-data",
    role: "mode",
    type: "switch",
    meaning: "remove the account but leave what the store holds of it, still searchable",
  },
  {
    name: "--delete-data",
    role: "mode",
    type: "switch",
    meaning: "remove the account and delete what the store and the tool's files hold of it",
  },
  {
    name: "--answer-stdin",
    role: "mode",
    type: "switch",
    meaning: "a sign-in step asks its question as a JSON line and reads the answer from stdin",
  },
  { name: "--hide-phone", role: "output", type: "switch", meaning: "leave the phone number out of the answer" },
]
