# Kit surface

## Scope

These are the parts of cli-core and cli-base that the template is built on. A CLI started with
`npx @wirecat/cli-template new` imports them from its first commit. When one of them changes in a way your code must
follow, the changelog gives the steps, and the template is already updated, so `npx @wirecat/cli-template upgrade`
brings the change into your CLI.

This page is a reference, not a rule page: it assigns no rule ids. How to start a CLI from the template is on the
[New CLI](new-cli.md) page. How a release is made is on the [Releases](releases.md) page.

## What the template imports

The list is what the template's `src/` and `scripts/` import today, type imports, re-exports and imports loaded on
demand included. `kit/` imports
nothing from either package.

| Package and path | Exports |
|---|---|
| `@wirecat/cli-base` | `catchCrashes`, `CliError`, `configFilePath`, `mcpErrorResult`, `resolvePaths` |
| `@wirecat/cli-base/commands` | `annotate`, `CommandInfo`, `COMMANDS_PAGE_LABELS` (in `scripts/`), `commandsPage` (in `scripts/`), `describeOptions` (in `scripts/`), `describeProgram` |
| `@wirecat/cli-base/codegen` | `writeArtifacts` (in `scripts/`) |
| `@wirecat/cli-base/release` | `DocsRules`, `JOURNAL_IDS`, `markdownFiles`, `packContents` (all in `scripts/`) |
| `@wirecat/cli-core/cli` | `AppIdentity`, `changesAuthorityAt`, `commandHelpMarkdown` (in `scripts/`), `commandsCommand`, `configCommand`, `Configuration`, `createProgram`, `environmentOf`, `GlobalFlags`, `httpTokenFile`, `itemOf`, `LOCAL_READ`, `LOCAL_WRITE`, `MCP_HTTP_DEFAULT_PORT`, `mcpServerCommand`, `outputFor`, `privateFiles`, `profileFree`, `ProgramDefinition`, `ProgramOptions`, `readOnlyLockOf`, `refuseUnderReadOnly`, `REMOTE_WRITE`, `renderAnswer`, `rootOf`, `run`, `RunOptions`, `runsCommand`, `settingsFor`, `skillCommand`, `upgradeCommand` |
| `@wirecat/cli-core/mcp` | `httpLockFile`, `MCP_PATH`, `McpCommand`, `portOf`, `publicUrlOf`, `registerCommands`, `revokeAll`, `runCommandForAgent`, `serveOverHttp`, `toolsFromCommands` |
| `@wirecat/cli-core/sends` | `Level` |
| `@wirecat/cli-core/update` | `appUpdate` |
| `@wirecat/cli-core/testing` | `ARGV_LOG`, `argvLogSetup` |

The template's config files also reach cli-base: `tsconfig.json` and `kit/tsconfig.json` extend
`tsconfig.base.json`, `tsconfig.test.json` and `tsconfig.scripts.json` extend the files of those names, `vitest.config.ts`
loads `@wirecat/cli-base/testing/setup`, and `.vale.ini` reads the styles in `config/vale`.

## The API generator

`@wirecat/cli-base/codegen` turns a service's API description into committed files: types, Valibot schemas, an
operation manifest and a coverage page. cli-core's `generatedApiCommand` builds the `api <operation>` group from the
manifest. The [reference](../REFERENCE.md) has the API; this section says what goes in, what a CLI can correct, and
what it cannot do yet.

### Inputs

| The service publishes | Read it with |
|---|---|
| OpenAPI 3.0 or 3.1 | `adaptOpenApi(document, { sourceUrl, sourceRevision })` |
| Swagger 2.0 | `adaptOpenApi(await upgradeToOpenApi3(document))` |
| Swagger 1.2 (Yandex Disk) | `upgradeToOpenApi3(listing, declarations)`: the resource listing, and each API declaration keyed by its `apis[].path`, fetched from the listing's `basePath` followed by that path |
| Google Discovery | `adaptDiscovery(readDiscovery(dir))`, snapshots written by `syncDiscovery` |

`upgradeToOpenApi3` converts with [swagger-converter](https://github.com/apigee-127/swagger-converter) (1.2 → 2.0) and
[@scalar/openapi-upgrader](https://github.com/scalar/scalar/tree/main/packages/openapi-upgrader) (2.0 → 3.0). They are
optional peer dependencies of cli-base: a CLI that converts adds them to its `devDependencies`. Commit the source as the
service serves it, with its URL and hash in `spec/<service>/provenance.json`, and convert in `scripts/generate.ts`.

From the source the generator reads:

- **Operations**: method and path, parameters, the request body (JSON, multipart or a form), and the first 2xx answer
  with a JSON body (`200`, `201` as HubSpot creates, `202`, or `2XX`), `application/hal+json` and other JSON types
  included.
- **Effect**: GET and HEAD read, POST, PUT and PATCH write, DELETE is destructive.
- **Servers and sign-in**: `servers`, `components/securitySchemes` and `security` go into the manifest as `servers`,
  `securitySchemes` and `security`, and an operation's own `security` (`[]` for one that needs no sign-in) onto that
  operation, so a CLI does not copy its base URL or OAuth endpoints by hand. They appear only when the source has them.

### Corrections a CLI passes to `generate`

- **`overrides`**: operation id → `{ effect, reason }`. The reason is required. An override that matches no operation
  stops generation.
- **The search rule**: a POST whose path ends in `/search` or `/query` (`:search`, `:query` too) is a read, as
  HubSpot's and Notion's are. An override with `effect: "write"` takes one back.
- **`permissions`**: `{ group, deletingFlags, shares }`. The CLI's own keys then hold over the raw `api` group too,
  not only `api.<operation>`. `group` is a name (`files`) or a function of the operation (one group per tag).
  - `<group>.delete` for every destructive operation (Yandex Disk's `DELETE /trash/resources` empties the whole
    trash), and for every operation that takes a flag in `deletingFlags`, as a top-level body field (Notion's
    `archived`, `in_trash`) or a query parameter (Yandex Disk's `permanently`, `overwrite`). cli-core checks the key
    when the flag is `true`.
  - `<group>.share` for the operation ids in `shares`: a public link opens a file to anyone, which is neither a
    plain write nor a delete.

  Which flags delete is the CLI's call: read the service's documentation, and count an undocumented flag as a delete.
  Each key lands in the manifest as the operation's `permissions`.
- **`auth`**: `{ securitySchemes, security, reason }` replaces the source's sign-in. Yandex Disk's Swagger 1.2 has no
  scheme, and its header is `Authorization: OAuth <token>`: `{ oauth: { type: "http", scheme: "OAuth" } }`.

### Provenance

The coverage page lists every operation, with its call, command, effect and how far its request body can be trusted
(`contract` or `example`). Under it, **Effects not taken from the HTTP method** lists each operation the search rule or
an override changed, with the reason, and **Calls guarded by a permission key** lists each key from `permissions` and
when it applies. A reviewer diffs this page after a spec sync.

### Limits

- One spec per run. Merging several specs (HubSpot publishes 127) is the CLI's job until the generator does it.
- No pagination description, no generated fake server: a CLI writes both by hand.
- A `$ref` to a shared response in `components/responses` is passed through without a shape.
- A Swagger 1.2 listing that embeds its operations, and Postman, RAML or GraphQL sources, are not read.
- cli-core checks an operation's `permissions`: until the CLI's cli-core does, the CLI adds the keys to its own
  `commandPermissions`, as notion-cli's `src/config.ts` does.
- Swagger 1.2 lists a status code more than once in one operation (Yandex Disk's 400 and 403); a JSON object holds
  one, so the conversion keeps one of them. Only 2xx answers reach the model.

## When one of them changes

A change that makes a CLI change its code for one of these exports ships with two things:

1. **A migration note in the changelog**, under "Changed — may break callers": what to change in your code, step by
   step. See [Documents](docs.md) for the changelog's shape.
2. **A green cli-template job before the pull request merges.** cli-base
   ([`template.yml`](https://github.com/WireCatLabs/cli-base/blob/main/.github/workflows/template.yml)) and cli-core
   (the `template` job in [`parity.yml`](https://github.com/WireCatLabs/cli-core/blob/main/.github/workflows/parity.yml))
   build the template against each pull request, so the template is updated in the same change, and `upgrade` has
   the new version to bring.

## How your CLI stays current

- **Exact versions.** The template depends on `@wirecat/cli-base` and `@wirecat/cli-core` at exact versions, the
  normal setup for every WireCat CLI. A CLI made from it starts with the same pins.
- **Dependabot.** The template's `dependabot.yml` checks `@wirecat/*` every day and opens one pull request for the
  shared packages within a day of a release. Its CI shows whether anything else needs to change.
- **`upgrade`.** In your CLI, with a clean git working tree:

  ```sh
  npx @wirecat/cli-template upgrade
  ```

  For each template file that changed since your version, it asks: apply (merge the change into your file, keeping
  your edits), replace, skip or diff. Without a terminal, `--apply`, `--replace` or `--skip` answers for every file,
  and `--dry-run` lists what each file would get. Then re-run community's `adopt-standards.py` for `config/wirecat/`.
