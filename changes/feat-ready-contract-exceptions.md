### Changed — may break callers

- **`cli-dev ready` needs every contract of the CLI's category, not one.** A contract the CLI does not run goes in
  `lint/contract-exceptions.json` with its reason (`[{ "contract": "crmSyncContract", "reason": "…" }]`); the row
  then shows partially with the reason, and the exit code does not wait for it. An exception without a reason, for
  another category's contract, for one that runs, listed twice, or for every contract is not verified, as is a file
  that is not a JSON list. A CLI that ran one contract of several and was verified under 0.108.0 now exits 1 until it
  runs or excepts the rest. [New CLI](../docs/standards/new-cli.md#done-when)
