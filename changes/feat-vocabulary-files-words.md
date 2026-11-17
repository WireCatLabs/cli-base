### Added

- **The vocabulary has `upload`, `publish`, `unpublish` and `stale`, and the flag `--tab <id>`.** drive-cli and
  notion-cli kept `files upload` as an override and cli-core's shared `memories stale` and `memories extract --tab` in
  a baseline; yandex-disk-cli needs the same words and `files publish` / `files unpublish` for a public link. A new
  documents CLI now passes `cli-dev lint` without either.
  `cli-dev lint` fails on a baseline or override entry the vocabulary now covers: at their next bump, drive-cli drops
  `files upload`, `memories stale` and `memories extract --tab` from `lint/baseline/`, and notion-cli drops
  `memories stale`, `memories extract --tab` and its `files upload` override.
