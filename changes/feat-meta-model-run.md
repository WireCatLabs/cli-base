### Added

- **`meta.model_run`: what a model a command calls on its own did in the run.** `{ provider, model, endpoint, sent,
  done, left, usage?, cost_usd, ms }`: the items sent, those handled, those left for the next run, the tokens the
  provider counted and the cost when a price is known. cli-core's mail `inbox` reports its sorting run in it
  ([WC-OUT-7](../docs/standards/output.md#wc-out-7--put-the-facts-about-the-run-in-meta)).
