### Added

- **`apiSkillFiles` writes the API part of a CLI's agent skill from the manifest and the command tree**: an index,
  `references/api.md`, and one file per tag, `references/api/api-<group>.md`, which an agent reads with
  `<cli> skill show api-<group>`. Usage, arguments and flags come only from `describeProgram`, matched to each
  operation by `api_operation`; a mismatch either way, two commands for one operation, two tags with one file name, a
  hand-written part that would hide a generated one, or a `SKILL.md` that does not link the index stops the
  generation. Vendor text is cut to one line and escaped. The manifest adds the call, effect, sign-in scopes, permission keys, paging
  and body schema. No examples are made up. `writeArtifacts` takes `owns`, folders that hold only generated files, so a
  file no longer generated is stale under `--check` and removed when writing.
  [Kit surface](../docs/standards/kit-surface.md#the-api-part-of-the-agent-skill)
