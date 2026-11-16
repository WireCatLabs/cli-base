### Fixed

- **`hostFetch` marks a failed name lookup or a refused connection `sent: false`** (`EAI_AGAIN`, `ENOTFOUND`,
  `ECONNREFUSED` on the cause), so a caller may send a write again that never left. A reset or a timeout keeps no
  mark: the request may have arrived.
