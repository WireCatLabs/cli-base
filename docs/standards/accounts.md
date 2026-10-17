# Accounts

## Scope

How a CLI chooses an account: the profile is always explicit, a read across accounts covers all of them and says so,
and scope flags work the same everywhere.

A **profile** is the name of one login of a CLI on one computer, for example `personal` or `work`. One profile can
hold a personal session, a bot token, or both.

Rule ids on this page are `WC-ACCT-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

### Who follows these rules today

cli-core resolves the profile for tg, max and wa. WC-ACCT-1 needs cli-core 0.319.0 or newer, and all three pin
0.321.0. memo has no messenger profile: its shared commands run without one, and they pick accounts with `--provider`
and `--account` (WC-ACCT-7). drive and zoom still have their own profile code: drive registers its own profiles, and
zoom keeps one saved profile in its config file. These are known gaps, not exceptions.

## Rules

### WC-ACCT-1 · Name the profile on every command that acts for an account

The profile is the first word on the command line, or the `<PREFIX>_PROFILE` variable. Nothing picks one for the
owner: not a config file, not the first profile in a list, not a profile called `default`, and not the only profile
on the computer.

- **Why:** which account a command speaks for is the owner's choice; a guess sends from the wrong account.
- **Enforced by:** `cli-core: src/cli/settings.test.ts`.
- **Example:** `tg personal chats list`, or `TG_PROFILE=personal tg chats list`. When no profile is named and the
  config file still has `default_profile`, cli-core stops and says which profile to type. `config set default_profile`
  is refused.
- **Exceptions:** a command that touches no account runs without a profile, for example `account list`,
  `config show` and `commands`.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-84.

### WC-ACCT-2 · The profile is a word, never a flag

There is no `--profile` option. The first word is the profile unless it names a command, and an option is never a
profile.

- **Why:** one place for the profile keeps every command line readable the same way, in every CLI.
- **Enforced by:** `cli-core: src/cli/profile.test.ts`.
- **Example:** `max work bot messages send …` uses the same first word as `max work chats list`. `tg --json chats list`
  still works, because `--json` is an option.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-84, NEED-294.

### WC-ACCT-3 · A missing profile is an error that lists the choices

When a command needs a profile and none is named, it fails with `validation_error`. The message and
`details.profiles` list the profiles on this computer. With no profile at all, the message says how to create one by
name.

- **Why:** the owner, or an agent, can fix the command from the error alone.
- **Enforced by:** `cli-core: src/cli/settings.test.ts`.
- **Example:** ``name a profile: `tg <profile> …` — profiles here: personal, work (or set TG_PROFILE)``. With none,
  the message says to ``create one with `tg personal setup` (any name in place of personal)``.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ACCT-4 · A profile name is a plain word and never a command word

A name has letters, digits, dot, dash and underscore only, and starts with a letter or a digit. A name that is also a
top-level command, such as `chats` or `bot`, is refused when the profile is created. `default` is an ordinary name.

- **Why:** the name becomes a file name and a keyring account, and a profile named after a command could never be
  selected.
- **Enforced by:** `cli-core: src/cli/profile.test.ts` · `cli-core: src/cli/settings.test.ts`.
- **Example:** `tg work setup` works. `tg chats setup` is refused with the list of command words to avoid.
  `tg a/../b setup` is refused as a name.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-294.

### WC-ACCT-5 · A profile lock pins a process to one profile

When `<PREFIX>_PROFILE_LOCK` is set, a first word or `<PREFIX>_PROFILE` that names any other profile is refused with
`permission_error`.

- **Why:** an agent must not escape its guards by naming a profile with fewer of them.
- **Enforced by:** `cli-core: src/cli/settings.test.ts`.
- **Example:** with `MAX_PROFILE_LOCK=agent`, `max personal messages send …` is refused, and `max messages list` runs
  as `agent`.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ACCT-6 · The most specific setting wins

A setting is read from the nearest of these sections: this profile's `personal` or `bot` entry, then the profile,
then every personal account or every bot (`personal.defaults`, `bot.defaults`), then `defaults`.

- **Why:** naming one account says more than naming all of them, so it must not be undone by a broader section.
- **Enforced by:** review only.
- **Example:** `defaults.sends_per_hour: 30` and `profiles.work.sends_per_hour: 10` give `work` a limit of 10.
- **Exceptions:** permissions layer the same way, with one more rule: see [WC-PERM-7](permissions.md).
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-355.

### WC-ACCT-7 · Never pick an account inside a provider for the owner

When a provider has several accounts, the command takes `--account <account>` or reads all of them. It never takes the
first account in a list.

- **Why:** the same reason as WC-ACCT-1, one level down.
- **Enforced by:** review only.
- **Example:** `memo search mail "invoice"` reads every mailbox; `--source email:work` reads one.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ACCT-8 · Scope flags have one meaning in every CLI

`--account` names one account. `--provider` reads every account of one provider. `--source` takes a comma-separated
list of `provider:account`, a provider, a kind, or `group:<name>`. `--all-bots` also reads the other bots' copies that
the config allows.

- **Why:** an agent that learned a flag in one CLI must not be surprised by it in another.
- **Enforced by:** `flag-two-meanings` · `flag-synonym` · `option-role` · `same-flag-meaning`.
- **Example:** `memo search messages "invoice" --source telegram,max`.
- **Exceptions:** `same-flag-meaning` runs weekly and does not block a pull request.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-ACCT-9 · A read across accounts covers all of them and says which it read

A read that is not limited to one account reads every account in its scope, and its answer names them, for example in
`coverage.accounts`.

- **Why:** an answer from part of the data must not look like an answer from all of it.
- **Enforced by:** review only.
- **Example:** `search messages` answers `coverage.accounts`; `search mail` names the mailboxes it read.
- **Exceptions:** a meaning search never reads wider than the running account unless `--source` says so. `search all`
  reads meetings only when they are named. Not every cross-account read reports its accounts yet.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** ss:8.

### WC-ACCT-10 · A bot reads another bot's copy only when the config and the command both say so

- **Why:** each bot's local copy belongs to that bot; reading it is a choice, not a default.
- **Enforced by:** review only.
- **Example:** `read_other_bots: ["support"]` in the bot's section, and `--all-bots` or `--bots support` on the command.
- **Exceptions:** none.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** bots:12.

### WC-ACCT-11 · Two identities become one person only when someone links them

A link between two identities, such as a Telegram contact and a MAX contact, is recorded only when someone asks for it
with the `link` verb
([cli-base's vocabulary](https://github.com/WireCatLabs/cli-base/blob/main/src/standards/vocabulary.ts)). It is never
inferred from a matching name, and `unlink` undoes it.

- **Why:** two people can share a name, and joining them would show one person's messages as another's.
- **Enforced by:** `cli-core: src/services/person-context.test.ts`.
- **Example:** `tg personal contacts link Ana max:Ana`. Until then, a Telegram Ana and a MAX Ana stay two people.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.44.0. **Rulings:** none.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-core `STANDARD.md`, "Command names"](https://github.com/WireCatLabs/cli-core/blob/022f69fb0acc86f6df05e074ec4df1b911ec94c6/docs/dev/STANDARD.md#command-names),
  rule 1 and the `link` verb in rule 3, as they stood before these rules moved to this page
- [cli-core `ARCHITECTURE.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/ARCHITECTURE.md), on the account-bound store
