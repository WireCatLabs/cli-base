### Changed — may break callers

- **`cli-dev ready` needs every contract of the CLI's category, not one.** A contract the CLI does not run goes in
  `lint/contract-exceptions.json` with its reason (`[{ "contract": "crmSyncContract", "reason": "…" }]`). The row then
  shows partially with the reason, and the exit code does not wait for it. An exception without a reason, for another
  category's contract, or for one that runs is not verified. [New CLI](../docs/standards/new-cli.md#done-when)
