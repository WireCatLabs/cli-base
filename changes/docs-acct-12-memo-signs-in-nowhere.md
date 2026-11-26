### Fixed

- **WC-ACCT-12 has no exceptions.** memo was listed as one, but it signs in to no account: it reads the stores of the
  other CLIs, and `memo models keys` keeps a model provider's key. The rule covers only CLIs that sign in, so memo was
  never under it.
