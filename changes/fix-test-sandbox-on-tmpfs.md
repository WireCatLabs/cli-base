### Fixed

- **On Linux the test sandbox starts in the runtime folder (`$XDG_RUNTIME_DIR`), which is in memory.** Every commit of
  a store waits for `fsync`, and on a disk other jobs keep busy a CRM sync in a test took 14 s instead of 1.5 s, past
  the 15 s test timeout, so a CLI's local release check failed three times in a row. With no runtime folder to write
  to, the sandbox starts in the temporary folder as before.
