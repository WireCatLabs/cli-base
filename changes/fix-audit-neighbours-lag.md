### Fixed

- **`cli-dev audit --family` no longer blocks a CLI on an entity schema a published CLI shares with it.** The published
  CLIs then already disagree among themselves, as when some are on an older cli-core, and the release cannot fix it.
  A schema no other CLI prints still blocks, and so does any shared one outside `--family`, where two local builds
  could vouch for each other. The rule cannot tell ahead from behind, and the first CLI to take a new schema still
  needs a declared difference. A CRM CLI made from cli-template on cli-core 0.695.0 was blocked on `entity hit`:
  cli-core 0.688.0 added the `crm_file` kind, and zm 0.80.0 prints it while tg 0.133.0, max 0.118.0, wa 0.45.0,
  cli-memo 0.143.0 and drive 0.71.0 do not yet. cli-base already declares that difference, but a CLI's own
  `config/parity-groups.json` replaces cli-base's groups and their differences.
