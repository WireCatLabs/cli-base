### Added

- **`upgradeToOpenApi3(document, declarations?)` converts Swagger 1.2 and 2.0 to OpenAPI 3** before `adaptOpenApi`,
  so a CLI for Yandex Disk (Swagger 1.2, 25 operations in six files) needs no converter of its own. It uses
  `swagger-converter` and `@scalar/openapi-upgrader`, new optional peer dependencies: a CLI that converts adds them to
  its `devDependencies`. An OpenAPI 3 document comes back as it is.
- **`adaptOpenApi` keeps the first 2xx answer with JSON**, not only `200`: HubSpot creates with 201, Yandex Disk
  answers 201 or 202. `application/hal+json` and `application/json; charset=utf-8` count as JSON.
- **`servers`, `securitySchemes` and `security` reach the manifest**, and an operation's own `security` (`[]` for no
  sign-in) the operation, so a CLI stops copying its base URL and OAuth endpoints by hand. `generate`'s new `auth`
  option replaces them where the source has none or a wrong one (Yandex Disk's `Authorization: OAuth <token>`).
  `manifestGenerator` writes the new exports only when the source has them; a CLI whose spec has `servers` sees its
  manifest change at the next `pnpm generate`.
- **A POST to a `…/search` or `…/query` path is a read** by default, as HubSpot's and Notion's are; an override with
  `effect: "write"` takes one back. The coverage page lists every effect the rule or an override set, with the reason,
  so a CLI's read overrides now add a section to its coverage page at the next `pnpm generate`.
- **`generate`'s `permissions` option gives the CLI's own keys to raw API calls**: `<group>.delete` for every
  destructive operation and every one that takes a deleting flag (body `in_trash`, query `permanently`, `overwrite`),
  `<group>.share` for the operations that make a public link. Each lands in the manifest as the operation's
  `permissions` and on the coverage page. cli-core does not check them yet; until it does, a CLI adds them to its
  `commandPermissions`, as notion-cli does.
- **The [kit surface](../docs/standards/kit-surface.md#the-api-generator) page describes the generator**: its inputs,
  the corrections a CLI passes, what the coverage page records, and its limits.
