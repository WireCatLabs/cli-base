### Added

- **A workspace's words in the vocabulary** ([#693](https://github.com/WireCatLabs/cli-base/issues/693)). The nouns
  `databases` (a source's databases, each a set of rows with typed properties) and `rows` (the records of such a
  database). The verb `reply` (answer in a comment thread at the source). The flags `--from-template <template>` (start
  a new page from one of the source's page templates), `--cover <link>` (a page's cover image, by an https link) and
  `--allow-deleting-content` (let an update delete the child pages its new text leaves out). notion-cli no longer needs
  an override for these words. drive-cli's `comments reply` override goes stale at its next bump and comes out then.
  `get` stays an old name for `show`, and a list without a query is still `list-without-query`.
