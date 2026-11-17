### Fixed

- **A CLI's own parity groups keep cli-base's declared entity schema and error reason differences.** `cli-dev audit
  --groups`, and `--family` reading `config/parity-groups.json`, replaced cli-base's groups along with differences
  such as `entity hit`, so every CLI made from cli-template blocked on a divergence cli-base had already accepted.
  These differences name no CLI list, so they now hold in any group and do not count against its budget of 10. Their
  `review_after` dates still apply: one long past it fails the audit of every CLI until cli-base renews or drops it.
