### Added

- **A file mirror's words in the vocabulary.** The nouns `mirrors` (saved pairs of a local folder and a folder in the
  source) and `conflicts` (files a mirror's sync could not merge). The flags `--keep <side>` (settle a conflict with
  local, the remote by its own name, or both), `--allow-deletions <count>` and `--allow-replacements <count>` (how far
  this run may go when the mirror's guard stops it) and `--repin` (a replaced folder is the mirror's folder now). cli-core
  mounts `mirrors conflicts list|show|resolve` under ydisk and drive, and the command lint no longer needs an override
  for these words. A replacement count is `--allow-replacements <count>`, not `--replace <n>`: `--replace` stays a
  switch, so a CLI that still names the count `--replace` gets `flag-two-meanings`. A `mirrors conflicts list` without
  a query is still `list-without-query`: WC-CMD-20 has one exception, `session list`.
