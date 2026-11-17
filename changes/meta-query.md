### Added

- **`meta.query`: what a search made of its query before it searched.** An optional, typed block of the answer
  envelope's `meta`: `{ chat?: { word, chat_id, title }, respelled?: [{ word, tried }] }`. `chat` says a word of the
  query named one chat and the search ran in it; `respelled` lists each unknown word and the known spellings tried in
  its place. A program or an MCP client reads the decision instead of parsing the note. `meta` stays strict: any other
  key is still refused. See
  [WC-OUT-7](../docs/standards/output.md#wc-out-7--put-the-facts-about-the-run-in-meta).
