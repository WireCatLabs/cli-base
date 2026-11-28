### Added

- **A CLI can name its fixed MCP port in its manifest.** `ManifestIdentity.mcpPort` writes `desktop.mcpServer.port` in
  `contracts/wirecat.json`, so WireCat Desktop reads the port of a WireCat tool's MCP server from the tool itself
  instead of its own catalog. Without `mcpPort` the key is absent and the manifest of every other CLI stays the same,
  byte for byte. A CLI that sets `mcpPort` without `mcp server start`, `stop`, `status` and `mcp revoke` is refused.
  Only WireCat's own tools set it, each with a port no other tool has
  ([reference](../docs/REFERENCE.md)).
