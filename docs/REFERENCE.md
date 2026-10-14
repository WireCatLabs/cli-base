# API reference

What each entry point holds and how to use it. The [README](../README.md) explains what the package is
and why it is built this way.

## Entry points

| | |
|---|---|
| `streams` | the stdout/stderr split, and the capture used to test it |
| `renderer` · `pretty` | `pretty` / `json` / `jsonl`; tables for lists, labelled lines for objects; `quiet` keeps only failures on stderr |
| `errors` · `exit-codes` | 14 closed error codes, one exit number each, so a script can branch on `$?` |
| `keyring` | `KeyringStore` with the system, memory and deliberately-broken implementations |
| `fieldsOf` · `projectFields` | validated field selection preserving list metadata and operation identifiers |
| `createOutputBuffer` | bounded UTF-8 output held until successful completion and resource cleanup |
| `createDeadline` | cooperative command cancellation with injected sleep and a parent abort signal |
| `time` | monotonic and wall clocks, and the one sleep that both timeouts and backoff use |
| `logger` | the four-method interface a host adapts Pino to — this package logs nothing itself |
| `paths` | config, state and cache in the XDG layout on Linux and macOS (`~/.config`, `~/.local/share`, `~/.cache`) and the `AppData` one on Windows, each overridable by environment variable; `migrateLegacyMacPaths` moves an older release's `~/Library` folders once |
| `config` | JSON config loading that names the bad field, and an atomic write that locks the directory down |
| `credentials` | environment → keyring → file, warning once and falling through when the keyring refuses |
| `logging` | `createRecordLog`: one `LogRecord` per JSON line (OpenTelemetry field names, flat), secrets and content-naming keys redacted at any depth, top-level keys off the allow-list (`LOG_ATTRIBUTE_KEYS` + `allow`) written without their value; `logRecordOf` builds the same record for a writer of its own; a file that cannot be written is reported to `onError`, never thrown |
| `retry` | full-jitter backoff, and the distinction between "no answer came" and "safe to repeat" |
| `/testing` | `captureStreams`, `memoryKeyring`, `brokenKeyring`, `fakeClock` |
| `/commands` | the command registry: `describeProgram`, `annotate`, `flatten`, `refuseJoinedPath`, and `commandsDocument` — the one `commands --json` shape, with its schema — see below |
| `/completion` | shell completion over the registry: `suggest`, `formatSuggestions` — see below |
| `/update` | keeping an install current: `installerOf`, `updateCommand`, `latestVersion`, `mayNotify`, `updateNotice`, `runUpdate` — see below |
| `/codegen` | build time: an official API description → types, Valibot schemas, an operation manifest and a coverage page — see below |
| `/release` | release time: `releaseCheck` and the checks it runs — changelog shape, links, package contents, version in step — see below |
| `/skill` | the CLI's SKILL.md for coding agents: `skillCommand` (`show`, `install`), `skillHint`, `skillResource` — see below |
| `/mcp` | local stdio MCP setup for Codex and Claude Code, plus a read-only handshake and tool-list probe |
| `/query` | one query language for every list: the Lucene 9.12.3 parser port, fields from an entity schema, validation, the Fields help and `evaluate` as a test oracle — see below |
| `/standards` | the registries the standard is made of — vocabulary, output envelope, error object and reasons, next steps, log record, lint rules — as Valibot schemas that also emit JSON Schema 2020-12 |

**Nothing in the root export is HTTP.** Status classification, `Retry-After` parsing and the fetch
seam live in `@wirecat/cli-base/http`, so a CLI that speaks a socket never depends on a stack it
does not call:

```ts
import { providerWaitMs, readJsonResponse, statusToCode } from "@wirecat/cli-base/http"
```

`readJsonResponse(response, { maxBytes, signal })` reads an existing response within an explicit
positive byte budget, then decodes strict UTF-8 JSON. It bounds declared length and actual body
bytes, cancels on rejection/interruption and releases its own reader. It never fetches or interprets
HTTP status, provider fields or credentials. A caller still owns those policies and its deadline.

**Portable command control stays independent of provider and store lifetimes.**
`fieldsOf("id,speaker.id")` parses up to 128 field paths; `projectFields(value, paths)` selects data
from objects or list items while preserving the list envelope and `operation_id`.
`items.id` also works for bare objects and JSONL items. Unknown fields are omitted; parent selections
win over their children. Unsafe prototype paths are refused, including when paths are passed directly.

`createOutputBuffer({ maxOutputBytes })` retains raw output chunks until `flush(write)` or `discard()`.
Its default limit is 4 MiB; zero disables the limit. It counts actual UTF-8 bytes, including delimiters
the caller passes, and adds no newlines. Use a new buffer for each command and flush only after resource
cleanup succeeds; discard on failure. A flush consumes the buffer even when its writer throws.
The `bytes` property reports the cumulative accepted byte count. A writer failure can leave partial
output; buffering only guarantees no output before flushing.

Optional `{ fields, format: "json" | "jsonl" }` projects before counting bytes. With projection,
each `data(text)` must contain a complete JSON value or complete JSONL lines; fragments fail before
buffering. Without projection, arbitrary text chunks work. Hosts can instead project values before
rendering and buffer the renderer's raw text. For core renderers, pass the line delimiter explicitly
when adapting `Streams.data`: `data: (text) => buffer.data(text + "\n")`.

`createDeadline({ timeoutMs, signal, sleep })` supplies a command signal and `race(body)`. An omitted
timeout creates no timer; zero aborts synchronously without calling sleep, and the maximum is 2147483647 milliseconds.
Pass its signal to every cancellable operation and check it before writes. On timeout or parent
cancellation, `race` waits for the body to settle before rejecting, so a caller can safely close
resources afterwards. An operation ignoring its signal can delay completion; this helper never
abandons it in the background. A body's more precise `outcome_unknown` error survives interruption.
Call `dispose()` in `finally` to remove the timer and parent listener. There are no process signal
handlers, retries, automatic resource cleanup or HTTP behavior in these helpers.

**The command registry is `@wirecat/cli-base/commands`** — the whole command tree as data, like
`rails routes`, for an agent to read instead of `--help` and for generated documentation. It walks
the live [Commander](https://github.com/tj/commander.js) tree, so a command built in a loop from a
catalog appears exactly like a handwritten one; `annotate` adds what the tree cannot say. Commander
is a type here, not a runtime dependency — an optional peer, 15 or newer.

```ts
import { annotate, describeProgram } from "@wirecat/cli-base/commands"

annotate(program.command("send"), { effects: { remote: "write", local: "none" }, examples: ["max messages send 42 hi"] })
annotate(generated, { origin: "generated", api_operation: "campaigns.list" })

describeProgram(program) // [{ path: ["send"], usage, origin, effects, options: [...], commands: [...] }]
```

`effects` says what a command touches, `remote` (the service) and `local` (this machine), each `none`, `read` or
`write`. A command without it counts as a write: the error handler never marks its failure safe to retry
(`error.retry.safe`), and a next step that runs it is never `safe_to_auto_execute`. `stepTargets(program)` gives
`stepOf` and `errorObjectOf` each command's effects and the names it takes, so a step that would not bind is dropped.

Each option says whether it `takes_value` and, separately, whether it is `mandatory` — not
Commander's `required`, which means "takes a value when given" — plus its choices, default,
environment variable, the options it `conflicts` with and the values it `implies`, keyed by long flag.
Every key of the document is snake_case.

**A list filters with one query, `@wirecat/cli-base/query`** — `tasks list state:open priority>1`, the
query positional and last, `[query...]`, over the entity's own snake_case keys. `queryFieldsOf(schema, annotations)`
reads the fields from the entity's Valibot schema (string → `kw`, a list of choices → `enum`, number → `num`, `isoTime` →
`time`, boolean → `bool`, `reference` → `ref`); annotations add the exceptions: words (`text`), relations,
`is:` states, examples, the fields a provider filters natively. `parseLucene(text, { defaultField: "none",
command })` refuses a bare word (`query.bare-word`); `validateQuery` checks names, operators, values and
placement and names every field when one is unknown; `fieldsHelp` prints the help's Fields section;
`QUERY_REASONS` registers the errors. A list filters where its data lives — its store or the provider — and
never in memory: `evaluate` exists to test those compilers against. `annotate(list, { output: { entity },
query })` puts both in `commands --json`, where `cli-dev lint` reads them.

`refuseJoinedPath(program, args)` throws a `validation_error` when a command path arrived as one
argument (`"projects add" --help`, what a zsh loop over `$c` passes), naming the words to type.
Commander would print the root help instead; call it on the words before `parseAsync`, after a
leading profile word if the CLI takes one.

**Shell completion is `@wirecat/cli-base/completion`**, built on the registry. `suggest` takes the
words typed so far and answers what may come next: a command, an action, an option, one of its
values, or an argument's values from a source the CLI hands in — a local cache, never the network,
because a shell calls it on every Tab. `formatSuggestions` writes the answer in the protocol of the
shell scripts [`@bomb.sh/tab`](https://github.com/bombshell-dev/tab) generates, so the CLI prints
those scripts with tab and answers `<cli> complete -- <words>` with this; cli-base itself does not
depend on tab.

```ts
import { formatSuggestions, suggest } from "@wirecat/cli-base/completion"

const words = argv.slice(argv.indexOf("--") + 1)
streams.data(formatSuggestions(suggest({ commands, globalOptions, words, sources: { arguments: { chat: chatNames } } })))
```

**Two traps worth knowing before you use the credential store.** The OS keyring is global: an entry
is addressed by service and account and knows nothing about which config directory asked for it, so
a throwaway config directory silently overwrites the real secret unless you pass `isolated: true`.
And a secret should never be handed to a logger in the first place — redaction by field name is the
second line of defence, not the first.

**Everything the environment knows can be passed in**: the clock, the sleep, the keyring, `env`,
`fetch` and the streams. The real ones are only defaults — `Credentials` without a `keyring` uses the
system keychain, `resolvePaths` without `env` reads `process.env`. Passing them is what makes a
timeout test finish instantly and a keyring test incapable of reaching a real keychain.

**Generating an API catalog is `@wirecat/cli-base/codegen`**, a build-time tool. It reads a
format-neutral `ApiModel` — operations with a transport binding (`http` method and path, or `rpc`
name), an `effect` (`read`, `write`, `destructive`) and how far the source can be trusted
(`contract`, `example`, `inferred`, `override`) — and writes committed files. It parses no file
format: the adapter from OpenAPI, Postman or anything else lives in the CLI that has that source,
so this adds no dependency. Generation stops, naming the problem, when two operations collide, an
operation is not classified as a read or a write, an override matches nothing, a reference points
nowhere or a construct cannot be expressed; it never drops an operation or falls back to `any`.

```ts
import { generate, manifestGenerator, typesGenerator, valibotGenerator, writeArtifacts } from "@wirecat/cli-base/codegen"

const artifacts = generate(model, [typesGenerator({ path }), valibotGenerator({ path, typesImport }), manifestGenerator({ path })], {
  overrides: { answerOnCallback: { effect: "write", reason: "a POST that edits a message" } },
  banner: ["Source: spec/bot/schema.yaml", "Run: pnpm bot:generate"],
})
const stale = writeArtifacts(artifacts, { root, check: process.argv.includes("--check") })
```

The generated schemas import `@wirecat/cli-base/codegen/runtime` at run time — a few number
helpers, not the generator. Numbers are expected from a lossless JSON parser (`lossless-json`): a
64-bit integer comes out as its exact decimal string, and any other integer that does not fit a JS
number fails instead of rounding. Objects are loose, so a field the API added later passes through.
Unions retain every alternative, including recursive references and Boolean literals.
`definitionsGenerator` emits the same schema nodes for runtime input traversal; RPC parameters can be in the JSON body.
Enums and discriminated unions are **strict**: a value or subtype the snapshot does not know fails,
so decode a live stream (updates, webhooks) only where that is what you want.

**The schemas decode; they do not encode.** Their output carries an `int64` as a string, so sending
it back would put a string where the API expects a number. Validate a request with the schema, then
send the original lossless value.

**Keeping an install current is `@wirecat/cli-base/update`.** `installerOf(realpath(script))` says
which package manager put the CLI there — pnpm, npm or bun, measured on real installs — and
`updateCommand` gives the argv that updates it; a checkout or `npx` gets none. `latestVersion` asks
npm with a timeout and answers `undefined` on any failure. `mayNotify` says whether a person is at a
terminal to be told: never in JSON, a pipe, `--quiet`, `CI` or with `NO_UPDATE_NOTIFIER`.
`updateNotice` is the whole daily line: it stays silent when `update` or `complete` is anywhere on
the command line, asks npm at most once a day through a state file the CLI names, and returns the
sentence or `undefined` — it never throws. `runUpdate` starts the package manager with its output on
stderr (`spawnPlan` is the Windows `.cmd` rule). Nothing here updates or prints by itself — a CLI
holding somebody's credentials must not change itself unasked.

**A CLI's guide for coding agents is `@wirecat/cli-base/skill`.** `skillCommand(app, skillUrl,
environment)` is `<cli> skill show` — SKILL.md on stdout, even into a pipe, or `{ name, content }`
with `--json` — and `<cli> skill install [--for claude|agents|all]`, which writes it to
`~/.claude/skills/<appName>/` and `~/.agents/skills/<appName>/` with the CLI's version as
`metadata.version` in the frontmatter, refusing a file whose `name` is not `<appName>`. `environment` is the host's own renderer, streams and `env` for that invocation.
`skillHint` is one line, or `undefined`, for an agent (`AI_AGENT` or `CLAUDECODE` set) with no copy
installed or an older one, at most once a day, through the same state file as `updateNotice`; the
host prints it on stderr. `skillResource` is what an MCP server registers to serve the file as
`<command>://skill`, plus a line for its `instructions` — the SDK stays the host's.

**The release checks are `@wirecat/cli-base/release`** — everything about a release that a program
can decide. A check is `{ name, run }`, and `run` returns the problems it found, one line each; an
empty list is a pass. `releaseCheck(checks, { version, log })` runs them all, even after a failure,
prints `ok` or `FAIL` per check and returns how many failed — the caller exits. The checks every CLI
shares: `command(root, "pnpm", "lint")` for anything that passes by exiting 0, `notOnNpm`,
`packContents` against a list of what may ship, `changelogProblems` for the fixed headings and the
dated top section, `docsProblems` for dead links and anchors and the rules of the pages a user reads,
and `versionScript` — the whole of a `version:check` / `version:sync` script. Each CLI passes its
own headings, id prefixes and pages; the checks that belong to one messenger stay in that CLI.

```ts
import { command, notOnNpm, packageVersion, releaseCheck } from "@wirecat/cli-base/release"

const version = packageVersion(root)
const failed = releaseCheck(
  [
    { name: "version not on npm", run: notOnNpm(root, "@wirecat/tg-cli", version) },
    { name: "lint", run: command(root, "pnpm", "lint") },
  ],
  { version, log: console.log },
)
process.exit(failed === 0 ? 0 : 1)
```

## Where secrets actually go, per platform

The keyring is real on every desktop and absent on most servers, so the fallback is not an edge
case — it is the normal path in CI and containers. Checked against `@napi-rs/keyring` 2.1.0 on
2026-09-19.

| Platform | Backing store | Needs installing |
|---|---|---|
| macOS | Keychain, via the Security framework | nothing — part of the OS |
| Windows | Credential Manager | nothing — part of the OS |
| Linux desktop (GNOME, KDE) | Secret Service over D-Bus — `gnome-keyring`, `kwallet` | nothing on a normal desktop; the keyring must be **unlocked** |
| Linux headless, container, WSL, CI | usually **nothing** — no session bus, no secrets daemon | falls back to a `0600` file, with one warning on stderr |
| FreeBSD | Secret Service, same as Linux | same |

**No compiler is involved.** The package ships prebuilt binaries for twelve platform triples —
macOS arm64/x64, Windows x64/ia32/arm64, Linux x64 and arm64 in both glibc and musl, armv7,
riscv64, FreeBSD x64 — so there is no Rust toolchain and no node-gyp on any mainstream target.
The Linux binary links only against libc: it speaks D-Bus itself rather than through libsecret,
so *libsecret is not a requirement* — a running Secret Service provider is.

Two consequences worth designing for rather than discovering:

- **`auto` is the right default and `file` must stay available.** `credentialStorage: "file"` skips
  the keyring entirely, which is what a container wants and what a locked keyring makes necessary.
- **A locked Linux keyring can block on a prompt** rather than failing. That is the one case the
  fallback does not rescue, and a CLI that hangs looks broken rather than locked.
