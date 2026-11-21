### Fixed

- **`cli-dev audit --family` installs again when the registry drops the connection.** npm's `--fetch-retries` does
  not cover a download cut off midway (`read ECONNRESET`), and about half the family installs failed that way. A
  network error now tries the install up to three times; any other error, such as a package npm does not have,
  fails at once as before.
