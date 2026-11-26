### Changed — experimental

- **drive is compared with the other CLIs on the shared roots only, as ydisk is.** It left the `all`, `mail-shared`
  and `gcal-shared` parity groups. Its `notes` and `search` are cli-core's documents commands: a note about one
  imported document is not memo's note of your own, and a search over imported documents is not the messengers'
  archive search. In `all` they differed from memo's and the messengers' in 21 paths, more than the group's budget
  of 10 differences. `commands`, `doctor`, `skill`, `mcp` and `upgrade` are still compared in `shared-roots`.
