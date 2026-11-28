### Added

- **`devices` is a resource word**: the devices and applications signed in to an account. cli-core renames the
  messengers' `account sessions` to `account devices`, so the lint knows the new group. `sessions` stays known until
  every messenger CLI has moved. The `--others` flag now means "every device but this one", and the permissions
  standard names `account devices end` and the key `account.devices.end`.
