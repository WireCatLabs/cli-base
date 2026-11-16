### Changed — may break callers

- **`Credentials#read` throws `keyring.unreachable` when the keyring fails and the file has no entry**, instead of
  answering "not signed in". A stale session bus (D-Bus restarted, the shell still holding the old `guid=`) made
  `@napi-rs/keyring` throw while the sign-in sat in the keyring, and every command said `session.missing`. The
  `configuration_error` names the keyring error and the file, and the fix on Linux: log out and back in, or set
  `DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus`. A file entry is still read first, `storage: "file"`
  never reaches the keyring, and `write` and `remove` still fall back to the file. With `storage: "keyring"` a failed
  read is the same `CliError`, not the raw native error. Watch for: a caller that reads before it writes now sees
  the throw on a machine with no keyring at all; cli-core's `credentialStorage` reads `previous` before a sign-in
  and wraps every read failure as `oauth.not-saved`, and its bot token `read` has no catch — let
  `keyring.unreachable` through there, and treat it as "no previous entry" on a sign-in.
