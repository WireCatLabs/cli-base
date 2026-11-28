### Added

- **A CLI can name the sync Desktop runs when it has several `<noun> sync` commands.** `ManifestIdentity.syncCommand`
  takes the command and its flags, `["messages", "sync", "--all"]`, and the manifest's `desktop.sync` then runs it and
  finds its last run. Before, such a CLI stated no sync, so Desktop kept its own words for the messengers. Words that
  name no command are refused ([reference](../docs/REFERENCE.md)).
- **A CLI can name Desktop's timer for its sync.** `ManifestIdentity.syncSchedule` writes `desktop.sync.schedule`
  with the interval a new timer starts with, the intervals Desktop offers and the command it runs. It needs cli-core's
  `schedule command`, `list`, `remove` and `run`. Without it the key is absent and the manifest stays the same, byte
  for byte.
- **A WireCat tool's sign-in methods can say where Desktop passes what the person typed.** `signIn.methods` takes
  `address`, `clientFile`, `portal` and `appId` (flags the command must take), `password` (the variable the CLI reads),
  `clientId` (the setting that names the person's own OAuth app) and `oauth` (the words for a browser sign-in), as
  Desktop's own catalog has them. Only `@wirecat` packages may set them, since Desktop refuses them from any other
  tool.
