### Added

- **A change log's words in the vocabulary.** The view `changes` (what a sync changed in the local copy since a time),
  and the flags `--since <time>` (from this time on, a time or a duration ago) and `--event <events>` (only these kinds
  of event). cli-core's shared `changes` command, which every documents CLI mounts with `documents history`, then
  passes `cli-dev lint` with no override.
