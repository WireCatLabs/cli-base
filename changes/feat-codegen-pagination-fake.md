### Added

- **`generate`'s `pagination: true` writes how each read pages into the manifest**, for an executor that reads every
  page (`--all`): a cursor (HubSpot's `after` → `paging.next.after`, Notion's `start_cursor` → `next_cursor`), an
  offset (Yandex Disk's `offset`, `limit` and `_embedded.items`), a page number, or a link to the next page. An
  override's `pagination` sets it where detection misses, `null` turns it off for one read, and the coverage page lists
  each read that pages. Off by default, so a CLI's generated files do not change until it asks.
- **`fakeApi({ operations, definitions, baseUrl, auth, answers, hosts })` is a strict fake built from the generated
  files**: a `fetch` that refuses an unknown path, method, query parameter or body field, a mistyped value and a
  missing sign-in, answers by the response schema, and throws on a scenario answer that breaks it. `hosts` serves
  the hosts an answer links to and refuses the sign-in header sent there. A CLI writes only its scenarios, not a fake
  of its service (notion-cli's is about 970 lines). `schemaProblems` and `sampleOf` are exported for a CLI's own
  checks.
