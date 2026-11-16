### Added

- **`upgradeToOpenApi3(document, declarations?)` converts Swagger 1.2 and 2.0 to OpenAPI 3** before `adaptOpenApi`,
  so a CLI for Yandex Disk (Swagger 1.2, 25 operations in six files) needs no converter of its own. It uses
  `swagger-converter` and `@scalar/openapi-upgrader`, new optional peer dependencies: a CLI that converts adds them to
  its `devDependencies`. An OpenAPI 3 document comes back as it is.
- **`patchSpec(document, { patches, stubMissingSchemas })` corrects a source before generation**, each change with its
  reason, in place of a CLI's own `scripts/<service>-spec.ts`: a value set at a JSON pointer, or a stub for every
  schema the document references but lacks (HubSpot's `Void`).
- **`adaptOpenApi` keeps the first 2xx answer with JSON**, not only `200`: HubSpot creates with 201 and answers a batch
  with 207, Yandex Disk answers 201 or 202. `application/hal+json` and `application/json; charset=utf-8` count as
  JSON, in answers and in request bodies.
- **`servers`, `securitySchemes` and `security` reach the manifest**, and an operation's own `security` (`[]` for no
  sign-in) the operation, so a CLI stops copying its base URL and OAuth endpoints by hand. `generate`'s new `auth`
  option replaces them where the source has none or a wrong one (Yandex Disk's `Authorization: OAuth <token>`).
- **`generate`'s `readingPosts: true` makes a POST to a `…/search` or `…/query` path a read**, as HubSpot's and
  Notion's are. It is off by default: a wrong guess would turn a write into a read.
- **`generate`'s `names` option names commands** where the operation ids make poor ones (HubSpot's
  `get-/crm/v3/objects/contacts_getPage`): an id → command map, and with `fromPath` names from the path and the method
  (`deals-list`, `deals-create`), with path segments renamed or left out (`{ "0-3": "deals", crm: "" }`).
- **`generate`'s `permissions` option gives the CLI's own keys to raw API calls**: `<group>.delete` for every
  destructive operation and every one that takes a deleting flag (body `in_trash`, query `permanently`, `overwrite`),
  `<group>.share` for the operations that make a public link. Each lands in the manifest as the operation's
  `permissions` and on the coverage page. cli-core does not check them yet; until it does, a CLI adds them to its
  `commandPermissions`, as notion-cli does.
- **The [kit surface](../docs/standards/kit-surface.md#the-api-generator) page describes the generator**: its inputs,
  the corrections a CLI passes, what the coverage page records, and its limits.

### Changed — may break callers

- **A CLI's generated files change at its next `pnpm generate`**, so `generate:check` fails until it is run. A source
  with `servers` or `securitySchemes` adds those exports to the manifest, and an operation with its own `security`
  gains that field. Overrides that change an effect add an "Effects not taken from the HTTP method" section to the
  coverage page. Operations whose only success answer is a 201, 202 or 207 now have a response schema.
- **A `security` requirement naming a scheme the document does not define stops generation**, as a dangling schema
  reference already does. So does a `$ref` security scheme: write the scheme in place, or replace the sign-in with
  `auth`.
