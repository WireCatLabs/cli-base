### Added

- **A sign-in method in `--wcat-describe` can name `site: "--site"` and `login: "--login"`.** WireCat Desktop
  (wirecat-desktop #459) signs in a CLI that uses cli-core's application password sign-in in its own window: it asks
  for the site, the user name and the password, passes the first two as those flags and the password on stdin. Until
  now `buildManifest` refused both keys, so a tool added from its describe signed in at a terminal only. Both go
  together, only with `stdin: true`, and only when the method's command takes both flags; any other flag is refused,
  as Desktop refuses it. See [the reference](../docs/REFERENCE.md).
