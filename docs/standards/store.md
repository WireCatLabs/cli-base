# Store

## Scope

How local data is kept: one shared store, its areas, account scope, migrations and store versions, what a delete
and a repair do to the data, and the rule that tests never touch the owner's store.

Rule ids on this page are `WC-STORE-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

Related pages: which account a read covers, and how a read across accounts is asked for, is in
[Accounts](accounts.md); the general test sandbox is in [Testing](testing.md); where secrets live is in
[Security](security.md).

### Words used here

- **The store:** the one SQLite file that cli-core opens for every CLI, `wirecat.db`.
- **Area:** one part of the store for one kind of record, such as `store.messages` or `store.chats`.
- **Store version:** the number of the newest migration the file has run. It is the `version` field of `MANIFEST`
  in cli-core's `src/store/sqlite/manifest.ts`.
- **Tombstone:** the mark a deleted message keeps in place of its content.

## Rules

### WC-STORE-1 · Keep local data in the one shared store that cli-core opens

- **Why:** one file for every messenger and account lets search, backup and export see everything in one place.
- **Enforced by:** review only.
- **Example:** `openStore` opens `wirecat.db` in the WireCat folder (`~/.local/share/WireCat/` on Linux,
  `%LOCALAPPDATA%\WireCat\Data\` on Windows). Rows are keyed by provider and account. `storePath` is the only code
  that reads `MESSAGING_STORE` and `WIRECAT_STATE_DIR`.
- **Exceptions:** none. Older documents that name `messages.db` describe a store that is no longer used.
- **Applies to:** CLIs that keep local data through cli-core (tg, max, wa, memo, drive, zoom). **Since:** cli-base 0.41.0.
  **Rulings:** NEED-383.

### WC-STORE-2 · Reach the data through its area, and add a new kind of record as a new area

- **Why:** an area keeps one kind of record in one file, so the store does not grow back into one long interface.
- **Enforced by:** `cli-core: biome noExcessiveLinesPerFile`.
- **Example:** `store.chats.saveChats(key, …)`, `store.messages.find(…)`, `store.tasks`, `store.mail`. Each area is a
  getter built on first use from its own file (`xStoreOver(context)`). `MessageStore` has no flat methods.
- **Exceptions:** none. cli-core's `biome.json` caps `src/store/store.ts` at 438 lines so that it does not grow again.
- **Applies to:** cli-core, and every CLI that calls the store. **Since:** cli-base 0.41.0 (store areas since
  cli-core 0.307.0). **Rulings:** none.

### WC-STORE-3 · A service of one account works through the store bound to that account

- **Why:** when no call takes an account, a row of another account cannot be read or written by mistake.
- **Enforced by:** `cli-core: src/services/account-isolation.test.ts`.
- **Example:** `accountStore(deps)` returns `store.forAccount(key)`; then `.messages.messages(chatId, …)` takes no
  account, and a row id of another account (an attachment, a mail thread, a meeting) is "not found". A read across
  accounts on purpose asks for the whole store with `crossAccount(deps, reason)`; see [Accounts](accounts.md).
- **Exceptions:** `forAccount` binds only the account areas (accounts, chats, sync, messages, attachments, roster,
  people, conversations, vectors, counters, tags, mentions). The `chats`, `conversations` and `attachments` services
  use the bound store; the other services still pair `deps.store()` with `deps.account()`. New code uses the bound
  store.
- **Applies to:** cli-core and every CLI that adds a service. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STORE-4 · Reach the store through its public module, never a table module

- **Why:** the table modules are the SQL layer; a caller that imports them skips the transaction and the account
  binding.
- **Enforced by:** review only.
- **Example:** in cli-core, `biome.json` is meant to refuse an import of `src/store/sqlite/*` from `src/services/`,
  `src/sends/`, `src/mcp/` and `src/cli/`; today it does not, because a later override replaces that rule
  ([WC-ARCH-1](architecture.md#wc-arch-1--call-only-the-layers-below-you-interface-then-service-then-port-then-adapter)). They import from `src/store/store.ts`, which re-exports what they need.
- **Exceptions:** tests of a table module.
- **Applies to:** cli-core. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STORE-5 · A CLI writes no SQL against the shared store

- **Why:** the schema belongs to cli-core; SQL in a CLI breaks on the next migration.
- **Enforced by:** review only.
- **Example:** a CLI that needs a new query asks cli-core for an area method, and the method lands in cli-core with
  its test. drive and zoom state "no SQL here" in their own architecture pages.
- **Exceptions:** a provider engine's own file of keys and device state, outside `wirecat.db`
  ([WC-STORE-13](#wc-store-13--keep-keys-and-device-state-out-of-the-shared-store)).
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-383.

### WC-STORE-6 · One store method is one whole operation, with no `await` inside a transaction

- **Why:** the driver is synchronous; an `await` inside a transaction lets the commit run before the awaited part.
- **Enforced by:** review only.
- **Example:** a write goes through `write` and a read of several queries through `read`
  (`src/store/sqlite/transaction.ts`), never Drizzle's `transaction` or a hand-written `BEGIN`. A large write runs
  in bounded batches, because it blocks the event loop while it runs.
- **Exceptions:** `replaceConversations` writes a new build in several short transactions on purpose. Readers see
  only the current build.
- **Applies to:** cli-core. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STORE-7 · Migrations only go forward: add, never edit or rebuild

- **Why:** a file that a newer build migrated must still open in the build already installed.
- **Enforced by:** `cli-core: src/store/sqlite/manifest.test.ts`.
- **Example:** a change is a new column that is nullable or has a default, or a new table. Triggers, full-text tables
  and data fills go in a custom migration. A mistake in a released migration is fixed by the next version. cli-core's
  manifest tests refuse a rebuilt base table, a gap in the versions and a bundle that differs from what drizzle-kit
  wrote.
- **Exceptions:** none.
- **Applies to:** cli-core. **Since:** cli-base 0.41.0. **Rulings:** NEED-383.

### WC-STORE-8 · Take the migration number before you write the migration

- **Why:** two branches with the same number leave one migration unapplied on stores that ran the other.
- **Enforced by:** review only.
- **Example:** edit the "next free version" line in cli-core `docs/dev/COORDINATION.md` in a pull request of its
  own, and wait for it to merge. Versions are the `version` field of `MANIFEST`; the initial migration is 1.
- **Exceptions:** none.
- **Applies to:** cli-core. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STORE-9 · Ship each migration with its schema spec, an upgrade test and a changelog line

- **Why:** the schema page, the code and the files already on disk must agree after every version.
- **Enforced by:** `cli-core: pnpm schema:check`.
- **Example:** change `scripts/schema/spec.mjs` first, then `schema.ts` until `pnpm schema:check` passes, then
  `pnpm db:generate` and `pnpm db:bundle`. Add a `src/store/version-<n>.test.ts` that opens a file at version n−1 and
  reads what version n added. The changelog entry names the store version, as in "Chat members in the store (store
  version 7)".
- **Exceptions:** none.
- **Applies to:** cli-core. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STORE-10 · An older build refuses a store it cannot read and says to upgrade

- **Why:** an older build that reads a file it does not understand corrupts it or answers wrongly.
- **Enforced by:** review only.
- **Example:** each migration keeps `minCompatible`. An additive change leaves it as it is (1 today). A change that
  drops what an older build reads raises it; that older build then refuses the file and asks to be upgraded.
- **Exceptions:** raising `minCompatible` needs the owner's approval. It is a major version of cli-core, and the CLIs
  ship their upgrade the same day.
- **Applies to:** cli-core and the CLIs that use the store. **Since:** cli-base 0.41.0. **Rulings:** NEED-867.

### WC-STORE-11 · A deleted message keeps a tombstone and loses its content

- **Why:** a delete must remove what the owner wanted gone, while the history still shows that something was there.
- **Enforced by:** review only.
- **Example:** a delete keeps a mark in the message row. Triggers erase its text, revisions, transcript, file text and
  tags, so a build that knows nothing about a newer table cannot leave content behind.
- **Exceptions:** none.
- **Applies to:** cli-core. **Since:** cli-base 0.41.0. **Rulings:** NEED-393.

### WC-STORE-12 · A repair never deletes data

- **Why:** the store is the owner's only copy of much of this data.
- **Enforced by:** review only.
- **Example:** `store repair` keeps a misshapen table as a copy, builds the correct one and copies the columns.
- **Exceptions:** none.
- **Applies to:** cli-core and the CLIs that expose `store repair`. **Since:** cli-base 0.41.0. **Rulings:** NEED-626.

### WC-STORE-13 · Keep keys and device state out of the shared store

- **Why:** a store that holds keys turns every backup and export into a secret.
- **Enforced by:** review only.
- **Example:** WhatsApp's linked-device keys live in a separate file per profile, `private.db`, which only the
  provider engine writes. Tokens go to the keyring ([Security](security.md)).
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-1395.

### WC-STORE-14 · Tests never open the owner's store

- **Why:** migrations only go forward; a test that opened the real file would migrate it, and nothing undoes that.
- **Enforced by:** review only.
- **Example:** the vitest `setupFiles` sandbox points `MESSAGING_STORE`, `WIRECAT_STATE_DIR` and each app's own
  directory variables at a temporary directory before any test runs. A test that defines a new app prefix adds it to
  the sandbox. A test that needs its own store is
  [WC-TEST-9](testing.md#wc-test-9--give-each-test-its-own-profile-or-its-own-store). The rest of the sandbox is
  [WC-TEST-1](testing.md#wc-test-1--point-every-path-a-test-could-write-at-a-temporary-directory).
- **Exceptions:** none.
- **Applies to:** all CLIs that use the store, and cli-core. **Since:** cli-base 0.41.0. **Rulings:** none.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-core `ARCHITECTURE.md`, "The store"](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/ARCHITECTURE.md#the-store)
- [cli-core `COORDINATION.md`, "Store migrations"](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/COORDINATION.md#store-migrations)
- [cli-core `TESTING.md`](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/TESTING.md)
