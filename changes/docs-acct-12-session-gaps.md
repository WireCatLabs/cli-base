### Fixed

- **WC-ACCT-12 no longer lists zm as a known gap:** zm 0.81.0 has `session list`, so it has all four session
  commands, as most CLIs that sign in now do. The tg, max and wa gap now names cli-core's `messengerSessionCommands`,
  which gives them the two commands they lack, and the drive gap says that its next release adds `session status`.
