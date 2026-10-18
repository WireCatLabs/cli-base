# Permissions

## Scope

What a CLI may do without asking: permission levels and keys, their defaults, the limits no level lifts, the write
guard and its journal.

Two words used on this page:

- A **write** is anything that changes something outside the local store: a message, a reaction, a group change, an
  account change.
- The **write guard** is the one check every write passes before it leaves the computer. cli-core builds it
  (`sendGuard`), from the profile's settings.

Rule ids on this page are `WC-PERM-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

### Who follows these rules today

tg, max and wa use cli-core's permissions and write guard in full. memo uses them for the shared commands only. drive
has its own policy and guard, with its own `--read-only` flag; zoom only reads. Where this page says "every CLI that
writes", drive is a known gap.

WC-PERM-10 and WC-PERM-11 need cli-core 0.321.0, which tg, max and wa pin. WC-PERM-12 as written needs cli-core
0.337.0; before it, the lock let through some local writes that overwrite what the owner saved. A command other
than `serve` and `watch` saves incoming history only from cli-core 0.343.0, and only when the messenger's adapter has
`listen`. wa is the one messenger whose history lives in the store; it pins 0.341.0 and has no `listen` yet.

## Rules

### WC-PERM-1 · `permissions` is the only access setting

A profile's `permissions` is a JSON object. Each key is a command path, and each value is a level. It holds the same
way for a command the owner types and for an agent over MCP. A config file that still has the old `read_only` or
`allow` settings is refused as an unknown setting.

- **Why:** one setting means one place to look when the owner asks "what may this profile do".
- **Enforced by:** review only.
- **Example:** `{ "permissions": { "messages": "allow", "messages.delete": "ask", "contacts": "readonly" } }`.
- **Exceptions:** the recipient list (WC-PERM-14), the hourly limit (WC-PERM-15) and the file guard
  ([WC-SECR-9](security.md)) are separate settings with separate jobs.
- **Applies to:** every CLI that writes. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-PERM-2 · There are four levels: `deny`, `readonly`, `ask`, `allow`

- `deny` — nothing, not even a read. The command answers `permission_error` (exit 5) before it connects, and an agent
  is not offered the command.
- `readonly` — reads work, writes answer `permission_error`. On a key that only writes, such as `messages.delete`, it
  is the same as `deny`.
- `ask` — a write asks first. See WC-PERM-9 for a terminal and [WC-MCP-7](mcp.md) for an agent.
- `allow` — goes ahead and never asks.
- **Why:** four words cover every choice the owner makes, and each one reads the same for every command.
- **Enforced by:** review only.
- **Example:** `tg work config set permissions.messages readonly`.
- **Exceptions:** none.
- **Applies to:** every CLI that writes. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-PERM-3 · A key is a command path, and the most specific key wins

Keys are dotted command paths, such as `messages`, `messages.delete` or `chats.members.remove`. There is no wildcard.
A key starts with a resource, so a misspelled key is refused, not ignored. Every command maps to exactly one key.

- **Why:** the owner names exactly what they mean, and a typo cannot silently allow more.
- **Enforced by:** review only.
- **Example:** `messages: readonly` with `messages.send: allow` lets the profile send but not edit or delete.
- **Exceptions:** see WC-PERM-4 and WC-PERM-5 for commands that map to another key or to none.
- **Applies to:** every CLI that writes. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-PERM-4 · A command that shows messages is checked as `messages`

A command outside `messages` that prints what people wrote, or who sent what, is checked against `messages` too.

- **Why:** `deny messages` must stop every way of reading messages, not only the `messages` commands.
- **Enforced by:** review only.
- **Example:** `inbox`, `review`, `watch`, `serve`, `conversations`, `attachments list`, `chats documents`, `mentions`,
  `contacts context`, `contacts timeline` and the `search` commands that read messages.
- **Exceptions:** `search notes` reads only the owner's notes.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-PERM-5 · Housekeeping is never gated

Commands that look after the tool and its files, and never show a message, have no key. No level stops them.

- **Why:** a profile that denies everything must still be able to fix its own config and log in.
- **Enforced by:** review only.
- **Example:** `config`, `session`, `doctor`, `commands`, `complete`, `upgrade`, `skill`, `models`, `server`,
  `schedule`, `runs`, `sends`, `recipients`, `flood`, `mcp`, `replies` where the messenger has replies, and
  `store info|check|migrate|backup|restore|repair|copies`. Under `bot`: `auth`, `list`, `sends`, `recipients`, `mcp`.
  wa has no `replies` group: its owner rules out automatic replies.
- **Exceptions:** what a schedule does, or a reply rule where the messenger has replies, is checked by its own key
  when it runs (`replies.send`).
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-PERM-6 · The built-in defaults ask only before what cannot be undone

With no `permissions` set, a profile may do almost everything. The built-in defaults are:

```json
{
  "messages.delete": "ask", "bot.messages.delete": "ask", "account.sessions.end": "ask",
  "topics.enable": "ask", "topics.delete": "ask", "chats.delete": "ask", "chats.clear": "ask",
  "replies.send": "deny"
}
```

A default is never made stricter without the owner's word.

- **Why:** the tool should work without questions; only a deletion, a logout or an automatic reply needs one.
- **Enforced by:** `cli-core: src/sends/permissions.test.ts`.
- **Example:** a new profile sends at once, and asks before `messages delete`.
- **Exceptions:** where the messenger has replies, `replies.send` is `deny`: a reply rule writes to people with nobody
  typing a command, so it waits for the owner's own `allow`. A messenger with no `replies` group, such as wa, has no
  use for the key.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-568.

### WC-PERM-7 · A built-in default only ever tightens

Against a broader key the owner set, the stricter of the two holds. A key the owner set at the same depth or deeper
wins. In the config file, a key in a nearer section also hides that key and every key under it in farther sections.

- **Why:** `messages: allow` must not remove the question before a deletion by accident.
- **Enforced by:** `cli-core: src/sends/permissions.test.ts`.
- **Example:** `messages: allow` still asks before `messages delete`; `messages.delete: allow` does not. A profile's
  `messages: readonly` is not undone by `messages.delete: allow` in `defaults`.
- **Exceptions:** none.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-PERM-8 · A permission path that moved is refused, not ignored

When a command path moves, a config that still names the old path stops the command with `configuration_error` and
says what to rename.

- **Why:** a `deny` under an old path would stop working without anyone noticing.
- **Enforced by:** review only.
- **Example:** `messages.search` is refused with "rename … to search.messages"; `messages.stats` with
  "rename … to stats.messages.show".
- **Exceptions:** none.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-PERM-9 · `ask` at a terminal is a y/N question, default no

The question shows what will change. A flag answers it: `--allow-dangerous` for a deletion nobody gets back, `--yes`
for every other write. With no terminal and no flag, the command answers `confirmation_required` (exit 7).

- **Why:** a deletion needs a flag a person has to mean, not a habit.
- **Enforced by:** review only.
- **Example:** `tg work messages delete @me 42 --allow-dangerous`.
- **Exceptions:** `--allow-dangerous` is the flag for `messages.delete`, `bot.messages.delete`, `topics.delete`,
  `chats.delete` and `chats.clear`; every other key takes `--yes`.
- **Applies to:** every CLI that writes. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-PERM-10 · A flag confirms; it never grants

`--yes` and `--allow-dangerous` only answer `ask`. They never lift `deny` or `readonly`. An `mcp` flag never grants
either ([WC-MCP-8](mcp.md#wc-mcp-8--no-mcp-flag-grants-access)).

- **Why:** a flag an agent can add must not be a way around the owner's settings.
- **Enforced by:** `cli-core: src/cli/messenger/messenger.test.ts`.
- **Example:** with `messages: readonly`, `messages send … --yes` is still refused.
- **Exceptions:** none.
- **Applies to:** every CLI that writes. **Since:** cli-base 0.41.0. **Rulings:** NEED-1423.

### WC-PERM-11 · Some limits no level lifts

An agent never deletes a message for everyone, and never ends the owner's other sessions.

- **Why:** both hurt people other than the owner, or lock the owner out, and cannot be undone.
- **Enforced by:** `cli-core: src/mcp/mcp.test.ts`.
- **Example:** MCP `messages delete` has no `for_everyone` argument. A messenger whose every delete is for everyone
  sets `Messenger.deleteForMe: false`, and there the MCP delete refuses with `permission_error` without connecting.
  No MCP command ends sessions; `account sessions end` exists only on the command line.
- **Exceptions:** the owner still has `messages delete --for-everyone` and `account sessions end` on the command line.
  The sessions limit holds today only because no agent command was written for it.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-202, NEED-1423.

### WC-PERM-12 · `<PREFIX>_READ_ONLY` refuses every write

When this variable is set, every write answers `permission_error`, whatever `permissions` or a flag say. So does a
command that writes only on this machine, unless cli-core marks it `destroysNothing`; a new local write is refused
until someone marks it. Logging in or out and a change to what a later run may do (a schedule, a setting, the
recipient list) are refused too. A `--dry-run` preview still runs.

- **Why:** an unattended agent needs one switch that the config file and `--permission` cannot undo, and that also
  keeps it from deleting or overwriting what the owner saved here.
- **Enforced by:** `cli-core: src/cli/effects.test.ts` · `cli-core: src/mcp/vocabulary.test.ts` ·
  `cli-core: src/mcp/mcp.test.ts` · `cli-core: src/cli/messenger/connected.test.ts`.
- **Example:** `schedule` starts an agent with `MAX_READ_ONLY=1`. It reads, drafts and adds tasks; `tags add` and
  `messages send` answer `permission_error`.
- **Exceptions:** receiving goes on: syncs, fetches, and saving incoming history. `serve` and `watch` save what
  arrives; on a messenger whose history lives in the store and whose adapter has the optional `listen`, so does any
  other command, an MCP session included (cli-core 0.343.0). Local writes marked `destroysNothing` run: what the store
  rebuilds (`store reindex`, `mentions rebuild`), a new file (`store backup`, `store export`, `stats charts`), and the
  task writes the follow-ups skill makes on a timer, where `tasks close` only suggests the close to the owner.
  Embedding and analysis on this machine run; sending text to an outside service for them is refused.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-PERM-13 · Every write passes the write guard before it leaves

The guard checks, in order: the read-only lock, the permission level, the recipient list, a flood hold from the
messenger, and the hourly limit. Then it reserves a line in the send journal. A background server runs the same guard
before every write it forwards, and so does an MCP server.

- **Why:** a model that was talked into sending by a message it read must be stopped by code, not by its own judgement.
- **Enforced by:** `cli-core: src/sends/guard.test.ts`.
- **Example:** `messages send`, `reactions add`, `chats members add` and `polls vote` all call the guard.
- **Exceptions:** the guard does not stop an agent that can edit the config file itself. Run an unattended agent under
  `<PREFIX>_READ_ONLY` or `<PREFIX>_PROFILE_LOCK`, somewhere it cannot write the config.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-161, NEED-269, NEED-772.

### WC-PERM-14 · The recipient list limits which chats a profile writes to

Each profile may have a list of chats, kept in a state file and changed with `recipients add` and `recipients clear`.

- No file means the check is off.
- A file with no chats means nowhere.
- A file that cannot be read refuses every write with `configuration_error`; it never opens up.
- A person added to a group must have a one-to-one chat on the list.
- A write to a chat not on the list answers `confirmation_required`, with the command that adds it.
- **Why:** the owner can fence an agent into a few chats without changing any level.
- **Enforced by:** `cli-core: src/sends/guard.test.ts`.
- **Example:** `max work recipients add 123456`.
- **Exceptions:** a bot has its own list.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-159, NEED-305.

### WC-PERM-15 · The hourly limit counts what puts something in front of a person

`sends_per_hour` is 30 for a personal account by default. A bot has no limit unless its `bot` section sets one.

- Counted: a message, a forward, an edit, each deleted message, a pin that notifies, a new group, each person added or
  let in, a join, and each imported phone number.
- Not counted: a reaction, a quiet pin, a title change.
- A scheduled message counts in the hour it is sent. One batch larger than the limit is refused.
- Over the limit, the write answers `rate_limited` with the time the next one is possible.
- **Why:** many writes at once is what the messenger reads as automation, and what bans an account.
- **Enforced by:** `cli-core: src/sends/guard.test.ts`.
- **Example:** `{ "defaults": { "sends_per_hour": 10 } }`.
- **Exceptions:** none.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-168, NEED-282, NEED-305.

### WC-PERM-16 · A retry of an unknown outcome counts once

When a write's outcome was unknown, a retry with the same send id in the same chat is not counted again. A retry under
another `--send-as` identity is refused, because it may post twice.

- **Why:** the provider delivers one message for both tries, so the limit must count one.
- **Enforced by:** review only.
- **Example:** `messages send … --operation-id 7f3c…` after `outcome_unknown`.
- **Exceptions:** none.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-277.

### WC-PERM-17 · The send journal records every write attempt, and never its content

Each attempt gets a line: time, profile, chat id, kind, action, count and outcome (`reserved`, `sent`,
`outcome_unknown`, `refused`, `failed`). A line never holds the text, a title, a new value, or a person's id. A failure
to write the journal after a send only warns.

- **Why:** the journal is what the hourly limit counts and what the owner audits; content in it would be a second copy
  of private messages. After a send, an error would invite a second send.
- **Enforced by:** `cli-core: src/sends/guard.test.ts` · `cli-core: src/sends/journal.test.ts`.
- **Example:** `{ "at": "…", "profile": "work", "chatId": "…", "kind": "message", "outcome": "sent" }`.
- **Exceptions:** none.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-161.

### WC-PERM-18 · A flood hold stops writes until it ends

When the messenger says the account may not write for a while, the profile holds every counted write until that time.
A standing hold, when the messenger reports the account frozen, limited or banned, holds every remote write: sends
and edits, and also reactions and read receipts (cli-core 0.334.0). A ban with no end date holds until the owner lifts
it or `doctor --online` finds the account well again. A spam limit or a frozen account with no end date holds for an
hour or a day. Reads still work. The owner lifts the hold with `flood clear`.

- **Why:** writing through a hold makes the messenger's penalty longer, or permanent.
- **Enforced by:** review only.
- **Example:** `max work doctor --online` shows the hold; `max work flood clear` lifts it once it is over.
- **Exceptions:** none.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-PERM-19 · Reading never marks anything read unless the command asks

- **Why:** the other side sees a chat marked read; that is a write the owner did not ask for.
- **Enforced by:** review only.
- **Example:** `inbox --mark-read`, or `catch_up_marks_read: true` in the config, both checked as `chats.mark-read`.
- **Exceptions:** none.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-566.

### WC-PERM-20 · A bot's keys are the personal keys under `bot`

`bot.messages.send` and `bot.chats.members.remove` are bot keys; `bot` alone covers every bot command. A profile can
allow its bot what it does not allow its personal account, and the other way round.

- **Why:** a bot and a personal account do different jobs and need different limits.
- **Enforced by:** review only.
- **Example:** `{ "messages": "readonly", "bot.messages.send": "allow" }`.
- **Exceptions:** bot housekeeping is never gated (WC-PERM-5).
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-294.

### WC-PERM-21 · Group actions happen only inside a command the owner typed

Moderation rules use the same four levels for each kind of action (delete, remove, accept, decline). `readonly` means
"report it, do nothing". A background `serve` never polls or moderates groups.

- **Why:** typing the command is the owner's consent for what the rules do.
- **Enforced by:** review only.
- **Example:** `tg work chats moderate @group` acts under `chats.moderate`; `tg work bot chats moderate` under
  `bot.chats.moderate`.
- **Exceptions:** an agent may run the same check over MCP, under the same levels. A rule's level is meant to be no
  looser than the profile's `chats.moderate`; the code does not check that yet.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-306, NEED-310.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-core `STANDARD.md`, "Permissions"](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/STANDARD.md#permissions)
