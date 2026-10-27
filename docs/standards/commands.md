# Commands

## Scope

How a command is shaped: its path and the verb and resource words it uses, flags and arguments, the effects and
lifetime it declares, the entity it prints, the query language for lists, the `mcp` setting and help text.

Rule ids on this page are `WC-CMD-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md). What a command prints is on the [output](output.md) page. How long it runs and how it ends is on
the [lifecycle](lifecycle.md) page.

The words themselves are not copied here. They live in the cli-base registries, and `cli-dev lint` reads them from
there:

- verbs, views, resources and root words: [`src/standards/vocabulary.ts`](https://github.com/WireCatLabs/cli-base/blob/main/src/standards/vocabulary.ts);
- flags with one meaning in every CLI, and the option roles: [`src/standards/flags-how.ts`](https://github.com/WireCatLabs/cli-base/blob/main/src/standards/flags-how.ts)
  and [`src/standards/flags-what.ts`](https://github.com/WireCatLabs/cli-base/blob/main/src/standards/flags-what.ts);
- the lint rules: [`src/standards/lint.ts`](https://github.com/WireCatLabs/cli-base/blob/main/src/standards/lint.ts); the audit rules and the required roots:
  [`src/standards/audit.ts`](https://github.com/WireCatLabs/cli-base/blob/main/src/standards/audit.ts).

A "messenger CLI" below is one of the CLIs that share cli-core's messenger commands: tg, max and wa. Their option
catalogue and parity manifest stay in cli-core
[`docs/dev/STANDARD.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/STANDARD.md).

## Paths and words

### WC-CMD-1 · Build every path as resource first, then a verb or a view

- **Why:** an agent that knows two commands can guess the third.
- **Enforced by:** `unknown-verb` · `unknown-resource`.
- **Example:** `<tool> [profile] [namespace] <resource> [subresource ...] <verb-or-view> [arguments]`, such as
  `tg work chats members list <chat>`. A collection is plural (`chats`). A thing a profile has exactly one of is
  singular (`account`). A group is never a verb.
- **Exceptions:** a root word stands alone (`doctor`, `upgrade`). Generated commands (`bot api`) mirror the official
  API's names.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-48, NEED-417.

### WC-CMD-2 · Take every verb, view, resource and root word from the cli-base vocabulary

- **Why:** one word has one meaning in every CLI, so `show` never means "list" somewhere else.
- **Enforced by:** `unknown-verb` · `unknown-resource`.
- **Example:** `show`, not `get` or `view`. Groups and channels are both `chats`. A new word goes into the registry in
  its own pull request first, and the owner approves the wording. Then the command uses it.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-199, NEED-417.

### WC-CMD-3 · Give a group without a leaf only its help, never a hidden default action

- **Why:** a group that runs something when its leaf is missing does work nobody asked for.
- **Enforced by:** `cli-core: src/cli/program.test.ts`.
- **Example:** `tg chats` prints the commands under `chats`. At a terminal the help goes to stderr and the exit code
  is 2. In machine mode the answer is a `validation_error` that names `--help`.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-4 · Add a root word only when no resource or namespace can hold the command

- **Why:** every root word is one more place an agent must look.
- **Enforced by:** `unknown-verb`.
- **Example:** statistics are `stats messages top`, not a new root `top`. The pull request that adds a root says which
  group could not hold it and which commands it groups. One new report never earns a root of its own.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-5 · Give every CLI the required root commands

- **Why:** agents and the cross-CLI audit start from the same entry points in every CLI.
- **Enforced by:** `required-root` (weekly audit; it does not block a pull request yet).
- **Example:** `commands`, `doctor`, `skill show`, `skill install`, `mcp`, `upgrade`.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-6 · Give one action or one report one leaf command

- **Why:** an option that turns a command into a different report hides that report from anyone reading the tree.
- **Enforced by:** review only.
- **Example:** ranking is `stats messages top`, not a ranking mode on `search messages`. Options choose the scope,
  measure, order or format of the same action. No command both shows and changes something.
- **Exceptions:** a documented preparatory fetch such as `--sync-first`. It keeps its own permissions and reports
  its outcome. `mcp --revoke` forgets every login given to a browser app; it stays an option on `mcp` because it
  belongs with the HTTP server's login state.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-1864.

### WC-CMD-7 · Never let two commands overlap

- **Why:** an agent that learns the narrow command never finds the wide one.
- **Enforced by:** review only.
- **Example:** a command whose main result is a search sits under `search <resource>` (`search all`,
  `search messages`), and every statistic under `stats <resource>`. A narrower scope is an option or a resource of
  the same command, not a sibling elsewhere. There is no `messages search` beside `search messages`.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-846, NEED-847, NEED-1087.

### WC-CMD-8 · Keep no aliases: a renamed path stops working in the release that renames it

- **Why:** two names for one command split the docs, the tests and what agents learn.
- **Enforced by:** review only.
- **Example:** the release notes give the old and the new path under "Changed — may break callers". Help, completion,
  generated pages, the skill, MCP names and permission keys move in the same change.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-417.

### WC-CMD-9 · Answer the naming questions in the pull request before you build a new command

- **Why:** a name is cheap to change before code, docs and agents depend on it.
- **Enforced by:** review only.
- **Example:** the pull request says what the user wants and which resource owns it, whether it is a new action or
  an option of an existing one, how its path maps to its MCP name, what it answers and what it may change, and what
  it moves or replaces.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-417.

## Flags and arguments

### WC-CMD-10 · Use a vocabulary flag for its meaning, and give one flag one kind of value everywhere

- **Why:** `--limit` must mean "how many items" in every command of every CLI.
- **Enforced by:** `flag-synonym` · `flag-two-meanings` · `same-flag-meaning` (weekly audit; it does not block a pull
  request yet).
- **Example:** `--limit <n>`, never `--max`, `--take` or `--count`. `--cursor <cursor>`, never `--offset`. How much
  to read is `--limit`, `--page` and `--page-size`. A count of pages is never an option.
- **Exceptions:** generated commands (`bot api`) are exempt from the naming rules.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-11 · Name an option in plain words, with the kind of value in the name

- **Why:** a wire field name means nothing to a person, and an option that guesses its value's kind guesses wrong.
- **Enforced by:** review only.
- **Example:** `--operation-id`, not `--cid`. `--before-id` takes a message id, `--after-time` a time, `--before-n` a
  count: two kinds are two options. A length of time is a `<duration>` with a unit (`500ms`, `30s`, `2m`, `4h`, `1d`),
  never a bare number.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-12 · Give every option a role from the vocabulary, and filter a list with its query

- **Why:** a filter flag per field grows without end and differs between CLIs. One query language does not.
- **Enforced by:** `option-role` · `filter-flag`.
- **Example:** the roles are paging, output, sort, mode, action, budget, scope, target, value and query. A list of open
  tasks is `tasks list state:open`, not `tasks list --state open`.
- **Exceptions:** `scope` flags pick accounts, providers or sources. They stay flags, because a scope is never picked
  for you.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-13 · Name arguments with a singular noun of the thing they take

- **Why:** the same thing has the same placeholder in every command, so an agent knows what to pass.
- **Enforced by:** review only.
- **Example:** messenger CLIs use `<chat>`, `<message>`, `<person>`, `<text>`, `<link>`, `<file>`, `<job>` and `<task>`.
- **Exceptions:** none.
- **Applies to:** all CLIs; the fixed list applies to messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-14 · Keep the shared global flags at their meaning

- **Why:** a script that works with one CLI works with the next.
- **Enforced by:** review only.
- **Example:** `--json` and `--jsonl` choose machine output. `--quiet` turns diagnostics off, but a failure is still
  said. `-v` and `-vv` add detail, `-V` prints the version, `--trace` writes request diagnostics, `--debug` adds the
  whole failure record. `--timeout <duration>` bounds the command. `--no-input` never prompts. `--dry-run` previews.
  `--yes` answers the question an `ask` permission level puts before a write.
- **Exceptions:** none.
- **Applies to:** CLIs that run on cli-core's `run()`. **Since:** cli-base 0.41.0. **Rulings:** NEED-125.

### WC-CMD-15 · Never prompt when no person can answer

- **Why:** a prompt in a pipe or under an agent waits for ever.
- **Enforced by:** review only.
- **Example:** `--no-input`, `--json`, `--jsonl`, a `CI` variable or a stdout that is not a terminal each switch prompts
  and browser logins off. Data piped on stdin for an explicit command still works. Buffered stdin stops at
  `--max-input-bytes` (16 MiB by default).
- **Exceptions:** none. `--yes` confirms a write; it never lifts a `deny`
  ([WC-PERM-10](permissions.md#wc-perm-10--a-flag-confirms-it-never-grants)).
- **Applies to:** CLIs that run on cli-core's `run()`. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-16 · Offer only ids in shell completion, with titles as their descriptions, from local data

- **Why:** the shell calls completion on every Tab, so it must be fast and must not touch the network.
- **Enforced by:** review only.
- **Example:** `tg messages show <Tab>` offers chat ids, each with the chat's title beside it. The values come from a
  local cache through `suggest` in `@wirecat/cli-base/completion`.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-270.

## What a command declares

Each of these is set with `annotate(command, { … })` from `@wirecat/cli-base/commands`, or
`annotateOption(option, { … })` for an option, and appears in `commands --json`.

### WC-CMD-17 · Declare `effects` on every command

- **Why:** retries and unasked next steps are judged on effects, and a command without them counts as a write.
- **Enforced by:** `missing-command-effects` · `cli-core: src/cli/effects.test.ts` · `cli-memo: src/effects.test.ts`.
- **Example:** `annotate(send, { effects: { remote: "write", local: "write" } })`. Each side is `none`, `read` or
  `write`. A sync that reads the service and writes the local store is `{ remote: "read", local: "write" }`.
- **Exceptions:** none. Without `effects`, the error handler never marks a failure safe to retry, and a next step
  that runs the command is never safe to run unasked.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-18 · Declare `lifetime` and `cooperative` instead of matching command names

- **Why:** the runner decides the deadline, the signal handling and the exit code from the metadata, never from the
  name, so a renamed command keeps its behaviour.
- **Enforced by:** review only.
- **Example:** `annotate(serve, { lifetime: "persistent" })` for a command that runs until stopped,
  `annotate(login, { lifetime: "interactive" })` for a login that waits for a person, `cooperative: true` for a long
  fetch that stops at its own pace. A runner reads them with `metaOf(command)`. What each does at run time is on the
  [lifecycle](lifecycle.md) page.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-19 · Declare the entity a command answers with

- **Why:** field projection, the query fields and the cross-CLI schema check all start from the entity.
- **Enforced by:** review only.
- **Example:** `annotate(list, { output: { entity: "meeting" } })`, or `{ entity: "contact", view: "profile" }` for a
  view of one.
- **Exceptions:** a command whose answer is not about the owner's data, such as `commands --json` or a `--dry-run`
  preview.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-20 · Give a list one query over its entity's fields, as its last argument

- **Why:** one query language for every list means an agent learns filtering once.
- **Enforced by:** `list-without-query` · `query-example`.
- **Example:** `tasks list state:open priority>1`. The list takes `[query...]` last. The fields come from the entity's
  Valibot schema through `queryFieldsOf`, and every field example and default term parses and validates. The list
  filters where its data lives, in the store or at the provider, never in memory.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-21 · Set `mcp: false` on a command, group or option that MCP servers must not offer

- **Why:** the MCP tools are generated from the command tree, so the tree says what stays off it.
- **Enforced by:** `src/commands/commands.test.ts`.
- **Example:** `annotate(flood, { mcp: false })` keeps `flood` and every command under it off MCP servers. The CLI
  still runs it. `commands --json` shows `mcp: false` on that command and each one below, and leaves the key out
  everywhere else. `annotateOption(forEveryone, { mcp: false })` leaves one option out of MCP tools' input, and only
  that option shows `mcp: false`. Which commands and options get it is on the [MCP](mcp.md) page.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-1411, NEED-1423.

## Help and discovery

### WC-CMD-22 · Describe every command, argument and option, with a summary of at most 80 characters

- **Why:** help and `commands --json` are where people and agents learn the command.
- **Enforced by:** `missing-command-help` · `missing-argument-help` · `missing-option-help` · `command-help-too-long`.
- **Example:** `.description("stored meetings, newest first")`.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-23 · Write help as the user sees the command: one line, lower case, no full stop, no internal term

- **Why:** a wire field, a port or an adapter name means nothing to the person reading help.
- **Enforced by:** review only.
- **Example:** an option says what it changes and its unit: `--pause <duration>` "wait this long between pages".
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-24 · Give every leaf command one to three examples that run as written

- **Why:** an example an agent copies must work.
- **Enforced by:** `command-example-count` · `faulty-help-example-parameters`.
- **Example:** `annotate(list, { examples: ["max chats list --limit 20"] })`. Each example starts with the tool, runs
  its own command, and gives only arguments and options that command takes.
- **Exceptions:** generated commands (`bot api`) need no examples.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-25 · Give a shared command and a shared option the same sentence in every CLI of its group

- **Why:** they are one command, so they read as one.
- **Enforced by:** `same-path-contract` (weekly audit; it does not block a pull request yet).
- **Example:** the shared factory in cli-core writes the description. A CLI changes it only to name its messenger.
- **Exceptions:** a sentence may differ where it names something the messenger's own way. The option catalogue in
  cli-core says why.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-26 · Print the command tree with cli-base's `commandsDocument`, and keep every key snake_case

- **Why:** agents, `cli-dev lint` and the audit read one shape from every CLI.
- **Enforced by:** `key-casing`.
- **Example:** `max commands --json` prints `{ cli, version, contract, description, global_options, … }`.
  `max commands search messages --json` describes one command and adds `scope` and `inherited_options`. An unknown
  or hidden path is a `validation_error` (exit 2) that lists the valid commands at that level.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-CMD-27 · Refuse a command path that arrived as one word

- **Why:** a shell loop that quotes `"projects add"` would otherwise get the root help and no reason.
- **Enforced by:** `src/commands/commands.test.ts` · `cli-memo: src/program.test.ts` · `cli-core: src/cli/program.ts`.
- **Example:** call `refuseJoinedPath(program, args)` before `parseAsync`. It throws a `validation_error` that names
  the words to type.
- **Exceptions:** none. memo and cli-core call `refuseJoinedPath` before parsing.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

## External references

### WC-CMD-28 · Use the external command-line references as a baseline, and keep the project's choices where they differ

The references, each for its own part:

* [POSIX Utility Conventions, §12](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap12.html): utility
  syntax, including `--` to end the options. Long options and the nested command tree are the project's own profile,
  not strict POSIX.
* [GNU Command-Line Interfaces](https://www.gnu.org/prep/standards/html_node/Command_002dLine-Interfaces): long option
  names, `--help` and `--version`.
* [Command Line Interface Guidelines](https://clig.dev/): discovery, streams, scripting and compatibility. A guide,
  not a certification.
* [MCP tools specification, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools): the
  contract of the MCP server, not of the shell grammar ([MCP](mcp.md)).
* [JSON Schema](https://json-schema.org/specification): the language of machine contracts. A schema says which
  dialect it uses.
* [Agent Skills specification](https://agentskills.io/specification): how the agent skill is packaged.
* [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents), the
  [CLI Agent Spec](https://cli-agent-spec.github.io/) and the
  [Google Workspace CLI agent context](https://github.com/googleworkspace/cli/blob/main/CONTEXT.md): ideas to weigh
  one by one. No conformance level is claimed, and the CLI Agent Spec's exit codes and response envelope are not
  adopted.

- **Why:** a person or an agent who knows these conventions can guess most of a WireCat CLI; where the project
  differs, it says so instead of half-following a reference.
- **Enforced by:** review only.
- **Example:** `tg --help` and `tg --version` print text on stdout, also when stdout is not a terminal. An agent
  learns a command from `tg commands <path> --json`; help is never a JSON answer. Data and failures follow
  [WC-OUT-4](output.md#wc-out-4--answer-every-json-request-with-one-envelope-a-list-or-one-thing),
  [WC-OUT-14](output.md#wc-out-14--print-a-failure-in-machine-mode-as-one-json-object-on-stderr-with-stdout-empty) and
  [WC-OUT-18](output.md#wc-out-18--exit-with-cli-bases-code-for-each-kind-of-failure), prompts follow
  [WC-CMD-15](#wc-cmd-15--never-prompt-when-no-person-can-answer), and a renamed path keeps no alias
  ([WC-CMD-8](#wc-cmd-8--keep-no-aliases-a-renamed-path-stops-working-in-the-release-that-renames-it)), unlike the
  deprecation advice of the Command Line Interface Guidelines. A read may have documented local effects, such as storing what it read or recording a failed
  run, so a failed command does not promise that it wrote nothing. A write is never retried on its own, and a tool's
  whole payload is never logged. The `stats` root and its resources are the project's own choice.
- **Exceptions:** the CLI Agent Spec's rule that help goes to stderr when stdout is not a terminal is not adopted. The
  Agent Client Protocol links an editor to a coding agent; a WireCat CLI is a tool an agent calls, so it adds no
  requirement.
- **Applies to:** all CLIs. **Since:** cli-base 0.43.0. **Rulings:** none.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-core `STANDARD.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/STANDARD.md): command names, agent
  execution contract, help text
- [cli-base API reference](https://github.com/WireCatLabs/cli-base/blob/main/docs/REFERENCE.md)
- [cli-core `STANDARD.md`, "External references and our adoption profile"](https://github.com/WireCatLabs/cli-core/blob/9be227198793fabf506ee946b10aaad94d84d519/docs/dev/STANDARD.md#external-references-and-our-adoption-profile)
