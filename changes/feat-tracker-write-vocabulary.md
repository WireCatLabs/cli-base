### Added

- **A tracker's write words in the vocabulary.** `--team <team>` sets the tracker team that owns an issue, and
  `--assignee` also takes `<user>`, one tracker user by id, name or e-mail, beside `<person...>`, people by UID.
  `comments` now include an issue's, and `--parent` an issue it sits under. cli-core's `issues create|update` and
  `issues comments create` then pass `cli-dev lint` and the family audit with no baseline in linear-cli
  (cli-core #3237).

### Fixed

- **`--priority <n>` says what it takes.** Its meaning named only the old 0 urgent … 4 low; it is the family's
  priority: low, medium, high, critical or none, a score from 0.0 to 1.0, or those old numbers.
