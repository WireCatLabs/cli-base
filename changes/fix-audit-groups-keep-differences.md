### Fixed

- **An audit by a CLI's own parity groups keeps cli-base's declared entity schema and error reason differences.**
  `cli-dev audit --groups`, and `--family` reading `config/parity-groups.json`, replaced cli-base's groups along with
  differences such as `entity hit`, so every CLI made from cli-template blocked on a divergence cli-base had already
  accepted. These differences name no CLI list, so they now hold in any audit, outside every group's budget. Past
  their `review_after` they only warn there: only cli-base can renew them, and its own weekly audit fails on them. A
  group that declares the same rule and target keeps its own entry.
