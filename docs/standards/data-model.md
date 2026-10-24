# Data model

## Scope

How records are modelled in the shared store: which entities cli-core owns, how a source's records relate to the
owner's real things, where provider ids go, what fields are called, and how records are linked without making
duplicates.

Rule ids on this page are `WC-DATA-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

Related pages: the store itself, its areas and migrations are in [Store](store.md); UTC times and date-only values are
in [Time](time.md); secrets that must never reach the store are in [Security](security.md).

### Words used here

- **Entity:** the real thing the owner means — a person, an event, a document. It carries no provider id. Tables:
  `persons`, `events`, `event_series`, `documents`.
- **Source record:** one source's copy of an entity — a mail contact, a Telegram user, a calendar entry, a Zoom
  meeting, a Drive file, a local file. It carries the account or provider it came from and that provider's id.
  Tables: `identities` (contacts), `calendar_entries`, `meetings`, `files`, `emails`, `messages`.
- **Link:** the reference from a source record to its entity, with how it was made.
- **Core entity:** an entity or source record whose table cli-core owns, because more than one tool may need it.

### Who follows these rules today

These rules are new. Older tables break some of them; a change to one of those tables follows the rule, and nothing
is rewritten only to follow it:

- Drive files are `documents` rows under a folder account, with Google's facts in `front_matter` JSON and the folder
  tree in `metadata.catalog` (WC-DATA-3, WC-DATA-5).
- Drive owners are linked by Google's user id under provider `google-drive`, mail senders by address under `email`,
  and nothing joins the two (WC-DATA-6).
- `events` rows made from Zoom meetings have no source record of their own besides the meeting (WC-DATA-2 holds:
  `meetings` is that record).

## Rules

### WC-DATA-1 · A record more than one tool needs is a core entity in cli-core; a CLI's own tables stay private

A core entity's table, model, store area and migration live in cli-core, and any CLI reads it through cli-core
(memo is the general reader). A CLI may keep tables of its own — checkpoints, caches, provider bookkeeping — and no
other CLI reads them. Transient state is never a core entity.

- **Why:** every tool and memo can rely on the same people, events and documents, while a tool's internals stay free
  to change.
- **Enforced by:** review only.
- **Example:** calendars, calendar entries, events, persons, contacts, documents and files are core; drive's sync
  checkpoint is drive's own.
- **Exceptions:** none. A CLI's own tables live in the shared store under its prefix (`drive_…`), with a migration
  track of its own (NEED-1737). cli-core does not run such a track yet; until it does, a CLI keeps no tables of its
  own and [WC-STORE-5](store.md) holds unchanged.
- **Applies to:** cli-core and every CLI. **Since:** cli-base 0.52.0. **Rulings:** NEED-1730, NEED-1737.

### WC-DATA-2 · Keep a source's records apart from the owner's entities, and link them

What a source returns is stored as a source record; the thing the owner means is an entity; the source record links
to its entity. One entity may combine source records from several sources and accounts.

- **Why:** the same meeting in two calendars and in Zoom is one event to the owner; the same document in Drive and on
  disk is one document.
- **Enforced by:** review only.
- **Example:** a Google Calendar entry is a `calendar_entries` row with `event_id`; the Zoom recording of that meeting
  is a `meetings` row with the same `event_id`.
- **Exceptions:** an entity the owner makes has no source record; a source record may wait unlinked until matching
  runs.
- **Applies to:** cli-core. **Since:** cli-base 0.52.0. **Rulings:** NEED-1731.

### WC-DATA-3 · A provider's id goes in `external_id`

The id a provider gives a record is stored in `external_id`, unique with `account_id` (or with `provider` where the
record has no account). Never in a column named after the provider (`google_id`, `file_id`) and never only in
`metadata`. A second id the provider also uses gets a named column of its own (`ical_uid`).

- **Why:** one place to look for every provider's id, and one unique key to update a record by.
- **Enforced by:** review only.
- **Example:** a Drive file: `files.external_id = '<Drive file id>'`; a Google calendar entry:
  `calendar_entries.external_id = '<event id>'`, `ical_uid = '<iCalUID>'`.
- **Exceptions:** a local file has no provider id; its `external_id` is its path relative to its folder root.
- **Applies to:** cli-core. **Since:** cli-base 0.52.0. **Rulings:** NEED-1732.

### WC-DATA-4 · Use the standard field names

| Meaning | Name |
|---|---|
| Primary key; a reference | `id`; `<entity>_id` (`event_id`, `document_id`) |
| Account, provider, provider's id | `account_id`, `provider`, `external_id` |
| Subtype; state | `kind`; `status` |
| Title of content (document, event, chat); name of a person, file or folder | `title`; `name` |
| Main text; its search form | `body`; `normalized_text` |
| Web link at the provider (never one that carries a secret) | `url` |
| File facts | `mime`, `size` (bytes), `content_hash` (sha-256 hex), `path` |
| Provider extras, front matter | `metadata` (JSON); front matter as `metadata.front_matter` |
| Our row's times | `created_at`, `updated_at`, `deleted_at` |
| The provider's times | `external_created_at`, `external_updated_at` |
| A span; last sync that returned the record | `starts_at`, `ends_at` (exclusive); `seen_at` |
| A date without a time | `<name>_date` (`YYYY-MM-DD`) |
| A yes/no | integer 0/1, an adjective (`all_day`, `starred`) |
| A link to any of several tables | `<noun>able_type`, `<noun>able_id` (`notable_type`) |
| History; search queue; folded text for filters | `<table>_revisions`; `<entity>_index_pending`; `<field>_folded` |

Times are UTC milliseconds ([Time](time.md)).

- **Why:** a reader of any table knows what a field holds, and a new table does not invent a third name for "edited
  at".
- **Enforced by:** review only.
- **Example:** `files.external_updated_at`, not `modified_at` or `modifiedAt` in JSON.
- **Exceptions:** existing columns keep their names until their table changes for another reason.
- **Applies to:** cli-core. **Since:** cli-base 0.52.0. **Rulings:** NEED-1732.

### WC-DATA-5 · A field the store filters, sorts, joins or lists on is a column; the rest is allow-listed JSON

- **Why:** columns can be indexed and checked; JSON keeps rare provider fields without a migration each.
- **Enforced by:** review only.
- **Example:** a Drive file's `mime`, `size` and `external_updated_at` are columns; its `sourceVersion` is
  `metadata.version`.
- **Exceptions:** none. `metadata` never holds secrets or a provider's raw payload ([Security](security.md)).
- **Applies to:** cli-core. **Since:** cli-base 0.52.0. **Rulings:** NEED-1733.

### WC-DATA-6 · Every link records how it was made; the owner's link wins; ambiguity makes no link

A link from a source record to its entity records its `method` (the rule, or `owner`), `confidence`, `author` and
time, and every change is logged. A rule never replaces an owner's link. When two candidates match equally well, no
link is made and the pair goes to the owner's review list. Title or time overlap alone never links records.

- **Why:** a wrong automatic merge is worse than a duplicate, and the owner must be able to see and undo it.
- **Enforced by:** review only.
- **Example:** `identity_links` and `identity_link_events` (contacts to persons); a Zoom meeting at 11:00 next to a
  10–11 and an 11–12 event links to neither by time alone.
- **Exceptions:** none.
- **Applies to:** cli-core. **Since:** cli-base 0.52.0. **Rulings:** NEED-1731.

### WC-DATA-7 · A source record the provider stops returning is soft-deleted; its entity and links stay

- **Why:** a sync error or a revoked share must not erase what the owner linked, wrote or searched.
- **Enforced by:** review only.
- **Example:** a calendar sync whose token expired lists again and sets `deleted_at` on entries it did not see; their
  events and meeting links stay.
- **Exceptions:** an entity with no live source record and no owner link may be removed by an explicit owner command.
- **Applies to:** cli-core. **Since:** cli-base 0.52.0. **Rulings:** none.

## Planned — not built yet

From the Wave 3 requirements (cli-private `plans/2026-10-24-open-cli-core-design.md`, under the owner's review):

- a `files` table as the source record of `documents`: a materialised `path` plus `parent_id` to the folder's own
  row, so a folder is found by path prefix and a document by part of its path (NEED-1739);
- memo's vault files as documents from a local source; `notes` are only the owner's notes on entities (NEED-1738);
- a migration track per CLI for its own prefixed tables, with the matching exception to WC-STORE-5 and WC-STORE-7
  (NEED-1737);
- `calendars`, `calendar_entries` and `calendar_attendees` on the `events` hub;
- an `email` column on contacts, so one address joins one person across sources;
- one link log for events and documents, and one review list for ambiguous pairs;
- renaming `identities` to `contacts`.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-core `ARCHITECTURE.md`, "The store"](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/ARCHITECTURE.md#the-store)
- cli-private `plans/2026-10-24-open-cli-core-design.md` (private; the rulings NEED-1730 to NEED-1734 are summarised
  above)
