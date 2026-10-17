# Architecture

## Scope

How the code is split: the layers and the direction of dependencies, no vendor type above the adapter, what belongs
in cli-base, in cli-core or in the CLI itself, who opens and closes a resource, and how a large unit is split.

Rule ids on this page are `WC-ARCH-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

Related pages: file size and one job per file are in [Layout](layout.md); import cycles are in
[Toolchain](toolchain.md); exit timing and closing before output are in [Lifecycle](lifecycle.md); the store's own
rules are in [Store](store.md).

## Words used here

- **Adapter:** the code that talks to one provider (Telegram, MAX, WhatsApp, Google Drive, Zoom) and translates its
  objects into our own types.
- **Port:** an interface that says what a service needs, for example `MessengerAdapter` or a store area.
- **Service:** a use case, written once, that both a command and an MCP tool call.
- **Composition root:** the place in a CLI where real implementations are chosen and connected, usually
  `program.ts` and the command context.
- **Vendor type:** a type from a provider library, such as `@mtcute/*` or `ws`.

## Rule template

```markdown
### WC-ARCH-<n> · <the rule, in one short sentence>

- **Why:** <one line>.
- **Enforced by:** <check names in backticks, joined by " · ">, or the words "review only".
- **Example:** <a command or a piece of code that keeps the rule>.
- **Exceptions:** <when the rule does not apply>, or "none".
- **Applies to:** <all CLIs, or which ones>. **Since:** cli-base <version>. **Rulings:** <ids>, or "none".
```

## Sources today

These documents explain the rules below in more detail. Where one of them disagrees with this page, this page holds.

- [cli-base `MODULARITY.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/dev/MODULARITY.md)
- [cli-base `ARCHITECTURE.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/dev/ARCHITECTURE.md)
- [cli-core `ARCHITECTURE.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/ARCHITECTURE.md)
- [cli-core `ADAPTERS.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/ADAPTERS.md)

## Rules

### WC-ARCH-1 · Call only the layers below you: interface, then service, then port, then adapter

- **Why:** when a command calls an adapter directly, the MCP tool for the same job does something different.
- **Enforced by:** review only.
- **Example:** cli-core has five layers: domain (`src/domain/`), adapters, ports (`port.ts`, the store), services
  (`src/services/`) and the interface (commands and MCP tools). Its `biome.json` refuses an import of `commander` or
  of `src/cli/` from the services and the layers below them, and an import of a command file from `src/mcp/`. What a
  command and a service share lives below the command.
- **Exceptions:** none. A new adapter method goes into a named group in `port.ts`, never into the domain.
- **Applies to:** all CLIs. Each repository's `biome.json` holds its own import rules. **Since:** cli-base 0.41.0.
  **Rulings:** none.

### WC-ARCH-2 · Dependencies point one way: a CLI depends on cli-core, cli-core on cli-base, never back

- **Why:** a shared package that imports an app cannot be shared.
- **Enforced by:** review only.
- **Example:** cli-base has no dependency on cli-core or on any CLI. cli-core's `biome.json` refuses an import of a
  messenger library or an adapter directory ("cli-core speaks no provider").
- **Exceptions:** none.
- **Applies to:** cli-base, cli-core and all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-3 · Only the adapter imports a vendor library; nothing above it sees a vendor type

- **Why:** the provider library underneath must be replaceable, and the layers above must not change when it is.
- **Enforced by:** review only.
- **Example:** in max-cli, `biome.json` lets only `src/client.ts` and `src/client/` reach the protocol, and only
  `src/adapter/` maps the client onto the shared messenger port. A field that only one provider has travels in
  `providerMetadata`.
- **Exceptions:** a bot slice that talks to an official HTTP API keeps its own transport, beside the personal
  account's adapter, never above it.
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

- **Why:** a command written once in cli-core gives every messenger the same path, flags and output.
- **Enforced by:** review only.
- **Example:** topics and polls are port groups and shared commands in cli-core. A messenger that lacks a capability
  refuses the command; it does not silently do less. A bot is another messenger with fewer capabilities, and tg and
  max share the bot code.
- **Exceptions:** a feature stays in one CLI only when the other providers cannot have it, such as MAX's socket server
  or Telegram's app registration.
- **Applies to:** messenger CLIs (tg, max, wa). **Since:** cli-base 0.41.0. **Rulings:** NEED-820, NEED-440,
  NEED-301, NEED-444.

### WC-ARCH-6 · Replace a use case, not a command

- **Why:** when a CLI replaces the service method, its command and its MCP tool both get the change.
- **Enforced by:** review only.
- **Example:** `Messenger.services` receives the shared services and returns only the ones it changes:
  `services: (base) => ({ messages: { ...base.messages, list: maxList } })`. To add a subcommand, a CLI calls
  `addCommand` on the command a factory returns.
- **Exceptions:** none.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

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
- **Enforced by:** review only.
- **Example:** in cli-core, `src/tasks/` and `src/meetings/` are entered only through their `index.ts`, `cli/`, `mcp/`
  and `testing/` entries; `biome.json` refuses the rest. memo, drive and zoom have a "public exports only" rule.
- **Exceptions:** tests may import what they test.
- **Applies to:** all CLIs. tg and max do not have the import rule yet. **Since:** cli-base 0.41.0. **Rulings:** none.

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
  commands read it with `environmentOf<Environment>(command)`, never with `process.*`.
- **Exceptions:** a CLI that does not use cli-core's command skeleton keeps one environment of its own.
- **Applies to:** CLIs built on cli-core's command skeleton. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-12 · Importing a module or listing the commands opens nothing

- **Why:** `commands --json`, help and completion must work with no account, database, keyring or network.
- **Enforced by:** review only.
- **Example:** a service is a factory over its dependencies, and the connection, the store and the account open on
  first use. A read from the store never connects. Heavy engines (speech, charts, PDF) load on first use.
- **Exceptions:** none.
- **Applies to:** all CLIs and the shared packages. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-13 · The code that opens a resource closes it

- **Why:** a resource with no clear owner is closed twice or never, and the process does not exit.
- **Enforced by:** review only.
- **Example:** the command context opens the services with `withServices`, and closes what was opened. A service
  never closes a connection it was handed. A borrowed connection has a `close` that does nothing. When and in what
  order things close is in [Lifecycle](lifecycle.md).
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-14 · Connect through `connectFor`, so a command inside serve borrows serve's connection

- **Why:** some providers allow one connection per account; a second connection drops the first.
- **Enforced by:** review only.
- **Example:** a messenger that allows only one connection sets `Messenger.connection: "exclusive"`. Its `serve`
  then runs other commands for the same profile through a local socket (the relay). `connectFor` gives a relayed run
  serve's own adapter, and refuses a run for another profile. A CLI's own command that connects also goes through
  `connectFor`.
- **Exceptions:** `serve`, `server`, `bot`, logins, `--offline`, `--dry-run` and `mcp --http` are never relayed.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-1389.

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
  the reason into the words `tg polls show`.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-17 · Split a large unit along a named seam, and dispatch by lookup, not by branch

- **Why:** a named seam gives each change one place to go; a branch per case grows without limit.
- **Enforced by:** review only.
- **Example:**
  - The tg adapter is a thin class over feature modules (folders, topics, groups, contacts, login, watch) that share a
    small feature context.
  - The cli-core store is a set of areas, each in its own file ([Store](store.md)).
  - The Lucene compiler has one compiler per field, picked from the field registry by name.
- **Exceptions:** do not scatter one operation into trivial files, add a barrel or wrap each function in a class only
  to meet a size limit. The size limits are in [Layout](layout.md).
- **Applies to:** all CLIs and the shared packages. **Since:** cli-base 0.41.0. **Rulings:** none.

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
  `console.log`.
- **Exceptions:** none.
- **Applies to:** cli-base and cli-core. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ARCH-20 · Keep HTTP out of cli-base's root export

- **Why:** a CLI that only speaks a socket must not depend on an HTTP stack.
- **Enforced by:** review only.
- **Example:** a helper that reads a status code or a header goes to `@wirecat/cli-base/http`.
- **Exceptions:** none.
- **Applies to:** cli-base. **Since:** cli-base 0.41.0. **Rulings:** NEED-15.
