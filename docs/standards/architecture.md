# Architecture

## Scope

How the code is split: the layers and the direction of dependencies, no vendor type above the adapter, and what
belongs in cli-base, in cli-core or in the CLI itself.

Rule ids on this page are `WC-ARCH-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

Related pages: file size, one job per file and how a large unit is split are in [Layout](layout.md); import cycles
and the lint that holds the layers are in [Toolchain](toolchain.md); who opens and closes a resource, what may open
at start-up and the `serve` relay are in [Lifecycle](lifecycle.md); the store's own rules are in [Store](store.md).

### Words used here

- **Adapter:** the code that talks to one provider (Telegram, MAX, WhatsApp, Google Drive, Zoom) and translates its
  objects into our own types.
- **Port:** an interface that says what a service needs, for example `MessengerAdapter` or a store area.
- **Service:** a use case, written once, that both a command and an MCP tool call.
- **Composition root:** the place in a CLI where real implementations are chosen and connected, usually
  `program.ts` and the command context.
- **Vendor type:** a type from a provider library, such as `@mtcute/*` or `ws`, and a type generated from a
  provider's API description, such as gcal's and drive's types under `src/generated/` from a Google Discovery
  document: both change when the provider changes, not when we do.

## Rules

### WC-ARCH-1 · Call only the layers below you: interface, then service, then port, then adapter

- **Why:** when a command calls an adapter directly, the MCP tool for the same job does something different.
- **Enforced by:** `cli-core: biome noRestrictedImports`.
- **Example:** cli-core has five layers: domain (`src/domain/`), adapters, ports (`port.ts`, the store), services
  (`src/services/`) and the interface (commands and MCP tools). Its `biome.json` refuses an import of
  `commander` or of `src/cli/` from the services and the layers below them, and an import of a command file from
  `src/mcp/`. What a
  command and a service share lives below the command.
- **Exceptions:** none. A new adapter method goes into a named group in `port.ts`, never into the domain. In Biome, a later
  override that sets `noRestrictedImports` for the same file replaces the earlier one's options, so every block that
  sets the rule carries the complete list for its paths.
- **Applies to:** all CLIs. Each repository's `biome.json` holds its own import rules. **Since:** cli-base 0.41.0.
  **Rulings:** none.

### WC-ARCH-2 · Dependencies point one way: a CLI depends on cli-core, cli-core on cli-base, never back

- **Why:** a shared package that imports an app cannot be shared.
- **Enforced by:** `cli-core: biome noRestrictedImports`.
- **Example:** cli-base has no dependency on cli-core or on any CLI. cli-core's `biome.json` refuses an import of a
  messenger library or an adapter directory ("cli-core speaks no provider").
- **Exceptions:** none.
- **Applies to:** cli-base, cli-core and all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-3 · Only the adapter imports a vendor library; nothing above it sees a vendor type

- **Why:** the provider library underneath must be replaceable, and the layers above must not change when it is.
- **Enforced by:** `max-cli: biome noRestrictedImports` · `tg-cli: biome noRestrictedImports` ·
  `whatsapp-cli: biome noRestrictedImports`.
- **Example:** in max-cli, `biome.json` lets only `src/client.ts` and `src/client/` reach the protocol, and only
  `src/adapter/` maps the client onto the shared messenger port. A field that only one provider has travels in
  `providerMetadata`.
- **Exceptions:** a bot slice that talks to an official HTTP API keeps its own transport, beside the personal
  account's adapter, never above it. Generated API types may also be used by the generated `api <method>` commands,
  which are the provider's own API by design; the shared ports and services never see them. In gcal,
  `calendar-source.ts` and `calendar-writer.ts` translate the generated event type into cli-core's calendar entry.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-12.

### WC-ARCH-4 · Put code in the lowest shared package that can hold it

- **Why:** the CLIs keep to one standard by sharing code, not by copying text.
- **Enforced by:** review only.
- **Example:**
  - cli-base: general CLI infrastructure that needs no domain knowledge. This includes the streams, the renderer,
    errors and exit codes, the keyring, config and paths, clocks, retry, the command registry and format-neutral code
    generation.
  - cli-core: provider-neutral models, ports and use cases, even when only one CLI uses them today. Meeting discovery
    is in cli-core although Zoom was its first user.
  - The CLI: vendor translation, profile binding, resource lifetimes and rules that only make sense for that product.
- **Exceptions:** share an invariant or a real capability. Lines that only look alike are not a reason for a new
  shared abstraction.
- **Applies to:** cli-base, cli-core and all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-292, NEED-440.

### WC-ARCH-5 · Build a feature that another provider could have as a shared command behind a capability

- **Why:** a command written once in cli-core gives every provider of a kind the same path, flags and output.
- **Enforced by:** review only.
- **Example:** topics and polls are port groups and shared commands in cli-core. A messenger that lacks a capability
  refuses the command; it does not silently do less. A bot is another messenger with fewer capabilities, and tg and
  max share the bot code. Calendars have the same shape: cli-core's `addCalendarCommands` builds `calendars`,
  `sync`, `status`, `events` and `search` over the `CalendarSource` and `CalendarWriter` ports, and mounts
  `calendars busy` or the event writes only when the provider has them.
- **Exceptions:** a feature stays in one CLI only when the other providers cannot have it, such as MAX's socket server,
  Telegram's app registration, or gcal's generated `api` commands.
- **Applies to:** messenger CLIs (tg, max, wa) and calendar CLIs (gcal). **Since:** cli-base 0.41.0. **Rulings:** NEED-820, NEED-440,
  NEED-301, NEED-444.

### WC-ARCH-6 · Replace a use case, not a command

- **Why:** when a CLI replaces the service method, its command and its MCP tool both get the change.
- **Enforced by:** review only.
- **Example:** `Messenger.services` receives the shared services and returns only the ones it changes:
  `services: (base) => ({ messages: { ...base.messages, list: maxList } })`. To add a subcommand, a CLI calls
  `addCommand` on the command a factory returns. A calendar CLI changes what the shared calendar commands do through
  the source and writer it passes to `addCalendarCommands`, never by writing its own `sync` or `events list`.
- **Exceptions:** none.
- **Applies to:** messenger CLIs and calendar CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-7 · Keep policy in the service; a command or MCP handler only parses input and presents the result

- **Why:** two transports that each interpret a query or a write policy drift apart.
- **Enforced by:** review only.
- **Example:** query interpretation, cursor binding, evidence checks and write policy live in the service. Each
  caller parses its own input, so an error names `--since` in a command and `since` in a tool, but both run the same
  method and give the same error for the same input.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-8 · Cross a module boundary only through the module's entry point

- **Why:** a deep import ties the caller to another module's internals.
- **Enforced by:** `pnpm lint` · `<app>: biome no-deep-wirecat-import` · `cli-core: biome noRestrictedImports`.
- **Example:** in cli-core, `src/tasks/` and `src/meetings/` are entered only through their `index.ts`, `cli/`, `mcp/`
  and `testing/` entries; its `biome.json` refuses the rest. Every repository refuses `@wirecat/<package>/src/…` and `/dist/…` outside tests. A
  package's own entry points are its `exports`
  ([WC-LAY-5](layout.md#wc-lay-5--add-an-entry-point-as-an-exports-entry-built-from-srcindexts)).
- **Exceptions:** a test inside a module may import what it tests; a test outside the module uses the entry point.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0.
  **Rulings:** none.

### WC-ARCH-9 · Pass the narrow port or callback a use case needs, not a whole store or container

- **Why:** a narrow dependency shows what the use case touches and is easy to replace in a test.
- **Enforced by:** review only.
- **Example:** a service sees the messenger as `MessengerTraits`, only the fields it reads. The CLI's `Messenger`
  adds how commands connect.
- **Exceptions:** none. Add a factory, inheritance or a dependency-injection framework only for a concrete benefit.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-10 · Pass every effect on the machine as an argument, with the real one only as the default

- **Why:** a test then replaces the clock, the keyring or the network, and never touches the real machine.
- **Enforced by:** review only.
- **Example:** clock, sleep, keyring, `env`, `fetch`, streams, stdin and the TTY check are parameters or fields of the
  command environment. Production code uses `environment.sleep ?? realSleep`. A new effect gets a new field, not a
  module mock.
- **Exceptions:** none. Watch the defaults: `new Credentials({...})` without `keyring` is the owner's real keychain,
  and `resolvePaths` without `env` reads `process.env`.
- **Applies to:** all CLIs and the shared packages. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-11 · Keep one command environment per program, cli-core's

- **Why:** two registries of the same environment must both be filled on every run, and one is always forgotten.
- **Enforced by:** review only.
- **Example:** a CLI extends `BaseEnvironment`, hands it to cli-core's `provide(program, environment)`, and its
  commands read it with `environmentOf<Environment>(command)`. `process.*` appears only as the default for a field
  the environment leaves unset, as WC-ARCH-10 says: `environmentOf(this).env ?? process.env`.
- **Exceptions:** a CLI that does not use cli-core's command skeleton keeps one environment of its own.
- **Applies to:** CLIs built on cli-core's command skeleton. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-12 · Merged into [WC-LIFE-6](lifecycle.md#wc-life-6--open-nothing-until-an-action-needs-it)

### WC-ARCH-13 · Merged into [WC-LIFE-1](lifecycle.md#wc-life-1--the-code-that-opens-a-resource-closes-it-so-a-one-shot-command-exits-when-it-has-answered)

### WC-ARCH-14 · Merged into [WC-LIFE-11](lifecycle.md#wc-life-11--run-commands-through-serve-when-the-messenger-allows-one-connection-per-account)

### WC-ARCH-15 · Each CLI runs its own background server, built on cli-core's process library

- **Why:** a server shared between CLIs couples their releases and their failures.
- **Enforced by:** review only.
- **Example:** cli-core's `./background` export holds the lock per app and profile, the PID check and the systemd and
  launchd units. `tg serve` and `max serve` are each built on it.
- **Exceptions:** none.
- **Applies to:** CLIs with a background process. **Since:** cli-base 0.41.0. **Rulings:** NEED-492.

### WC-ARCH-16 · Layers below the commands never name a command

- **Why:** an adapter that prints "check `tg polls show`" breaks when the command is renamed and cannot be shared.
- **Enforced by:** review only.
- **Example:** a tg adapter error carries a typed reason, such as `{ check: "polls.show" }`. The command layer turns
  the reason into the words `tg polls show`. A flag counts as naming a command, for the same reason: an adapter
  refusal carries `{ option: "link" }`, and the command layer writes `--link`.
- **Exceptions:** none. tg's `src/telegram/errors.ts` (`--anonymous`, `--correct`) and wa's adapter (`--link`,
  `--for-everyone`) still name flags.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-17 · Merged into [WC-LAY-8](layout.md#wc-lay-8--give-each-module-one-reason-to-change)

### WC-ARCH-18 · An optional capability that is missing fails out loud

- **Why:** a request that quietly becomes a smaller one gives the caller a wrong answer that looks right.
- **Enforced by:** review only.
- **Example:** a new adapter method is optional and reached with `capability()`. When it is absent, the command
  refuses with a reason; it does not drop the filter or the scope it could not apply.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-820.

### WC-ARCH-19 · Shared packages print nothing and log nothing on their own

- **Why:** what is written, and where, is the host's decision; a stray line breaks machine output.
- **Enforced by:** review only.
- **Example:** cli-base hands the host a `Logger` interface, a Pino adapter and a renderer. It never calls
  `console.log`, nor `console.error`, which the lint allows elsewhere
  ([WC-TOOL-9](toolchain.md#wc-tool-9--write-to-the-console-only-with-consoleerror-except-in-scripts)).
- **Exceptions:** none.
- **Applies to:** cli-base and cli-core. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-20 · Keep HTTP out of cli-base's root export

- **Why:** a CLI that only speaks a socket must not depend on an HTTP stack.
- **Enforced by:** review only.
- **Example:** a helper that reads a status code or a header goes to `@wirecat/cli-base/http`. How an entry point
  is added is [WC-LAY-5](layout.md#wc-lay-5--add-an-entry-point-as-an-exports-entry-built-from-srcindexts).
- **Exceptions:** none.
- **Applies to:** cli-base. **Since:** cli-base 0.41.0. **Rulings:** NEED-15.

### WC-ARCH-21 · A CLI registers its provider in the store; an unknown provider's rows are skipped, never guessed

Every run, a CLI writes its provider's entry — `{ name, kind, aliases, command }` — with
`store.accounts.registerProvider(entry)` on the store from `openStore()` (`@wirecat/cli-core/store`). cli-core reads its built-in providers plus the stored entries when the store opens, so
every other CLI knows the new provider's kind without a cli-core release. A row whose provider no entry names is left
out of search and listed under `skipped`, with the hint to run that CLI once.

- **Why:** a new source joins search and memo without editing cli-core, and a provider nobody described is never read
  as something it is not (until this rule, an unlisted provider was searched as a messenger).
- **Enforced by:** `cli-core: src/store/sqlite/providers.test.ts`.
- **Example:** gcal registers `{ name: "google-calendar", kind: "events", aliases: ["gcal", "calendar"], command:
  "gcal" }` each time it opens the store. On a machine where gcal has never run, a search across accounts lists
  gcal's accounts under `skipped` instead of reading their rows as messages.
- **Exceptions:** the built-in providers of cli-core need no entry. Two entries that disagree on a kind are an error
  naming both.
- **Applies to:** cli-core and every CLI with a provider of its own. **Since:** cli-base 0.53.0. **Rulings:** none
  (Wave 3 requirements 3.2).

### WC-ARCH-22 · Build the command tree once; keep each call's state out of it

The Commander tree — commands, options, help, actions — describes the CLI and is the same for every call, so it is
built once per process. What belongs to one call (its streams, signal, deadline, environment, profile and parsed
options, its hooks) lives in a per-call context that the action receives, never on the `Command` objects.

- **Why:** state written into a shared tree leaks into the next call. Commander restores option values to what they
  were before the *first* parse, so a profile set on the tree before parsing becomes every later call's starting
  value, and a hook added per call runs once more each time. Building a fresh tree per call avoids the leak but costs
  an MCP server ~16 ms per tool call for tg.
- **Enforced by:** review only.
- **Example:** a check that always gives the same answer for the same definition (`defineQuery`'s examples,
  `assertSharedContracts`) runs once per definition, not per build. A new per-call value goes into the call's context,
  not into `setOptionValue`, `hook` or `provide` on the tree.
- **Exceptions:** cli-core's `run()` still builds a fresh tree per call, because it writes the call's environment,
  a `preAction` hook and the profile into it; moving that to a per-call context is
  [CORE-41](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/BACKLOG_LATER.md). New code does not add to it.
- **Applies to:** cli-core's command skeleton and every CLI built on it. **Since:** cli-base 0.65.3. **Rulings:** none.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-base `MODULARITY.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/dev/MODULARITY.md)
- [cli-base `ARCHITECTURE.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/dev/ARCHITECTURE.md)
- [cli-core `ARCHITECTURE.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/ARCHITECTURE.md)
- [cli-core `ADAPTERS.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/ADAPTERS.md)
