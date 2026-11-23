import type { VocabularyFlag } from "./vocabulary.js"

/** How a file mirror's run settles what both sides changed, and how far its guard lets it go. */
export const MIRROR_FLAGS: VocabularyFlag[] = [
  {
    name: "--keep",
    value: "<side>",
    role: "mode",
    type: "choice",
    meaning:
      "settle a conflict with one side: local, the remote by its own name (disk, drive), or both, the other kept " +
      "as a conflict copy",
  },
  {
    name: "--allow-deletions",
    value: "<count>",
    role: "mode",
    type: "count",
    meaning: "let this run delete up to this many files when the mirror's guard stops it; owner only",
  },
  {
    name: "--allow-replacements",
    value: "<count>",
    role: "mode",
    type: "count",
    meaning: "let this run overwrite up to this many existing files when the mirror's guard stops it; owner only",
  },
  {
    name: "--repin",
    role: "mode",
    type: "switch",
    meaning: "accept that a replaced local or remote folder is the mirror's folder now, and sync it; owner only",
  },
]
