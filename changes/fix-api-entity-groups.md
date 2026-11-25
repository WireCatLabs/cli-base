### Changed — experimental

- **A GraphQL CLI's agent skill has one API page per entity, not one for queries and one for mutations.**
  `adaptGraphql` now gives each operation two tags: first the entity its field name acts on (`issueLabelCreate` →
  `issue-label`, `searchIssues` → `issue`), then `query` or `mutation` as before. `apiSkillFiles` files a page per
  first tag, so an agent that wants to archive an issue reads `<cli> skill show api-issue` instead of Linear's
  4,335-line `api-mutation` page. Regenerating replaces `api-query.md` and `api-mutation.md` with the entity pages, and
  `api show` prints both tags. Commands, their names and permission keys stay the same. `api list tag:mutation` still
  works, and `tag:issue` now works too. A CLI that groups its `api` commands by tag (`names.groups: "tags"`) would mount
  them by entity; no GraphQL CLI does today.
