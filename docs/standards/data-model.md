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
- `events` rows made from Zoom meetings have no source record of their own besides the meeting (WC-DATA-2 holds:
  `meetings` is that record).
- Drive's stand-in folder account still has provider `folder`; an Obsidian vault is `obsidian` and a plain folder is
  `local` (WC-DATA-3).
- `documents` keeps its source columns (`account_id`, `external_id`, `url`, `mime`, `front_matter`…) next to the
  entity's own fields (WC-DATA-2).
- `meeting_participants` is unique on the meeting and the contact; its `external_id` is in no unique key (WC-DATA-3).

The calendar tables that gcal fills through cli-core (`calendars`, `calendar_entries`) follow them from the start.

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
- **Exceptions:** none. A CLI's own tables live in its own SQLite file next to the shared store, with its own
  migrations, and refer to core rows by id only; no other CLI opens that file (NEED-1737). The shared store stays
  cli-core's alone ([WC-STORE-5](store.md)).
- **Applies to:** cli-core and every CLI. **Since:** cli-base 0.52.0. **Rulings:** NEED-1730, NEED-1737.

### WC-DATA-2 · Keep a source's records apart from the owner's entities, and link them

What a source returns is stored as a source record; the thing the owner means is an entity; the source record links
to its entity. One entity may combine source records from several sources and accounts.

- **Why:** the same meeting in two calendars and in Zoom is one event to the owner; the same document in Drive and on
  disk is one document.
- **Enforced by:** `cli-core: src/store/sqlite/schema.test.ts` (the entity tables only; which table is which kind is
  review).
- **Example:** a Google Calendar entry is a `calendar_entries` row with `event_id`; the Zoom recording of that meeting
  is a `meetings` row with the same `event_id`.
- **Exceptions:** an entity the owner makes has no source record; a source record may wait unlinked until matching
  runs.
- **Applies to:** cli-core. **Since:** cli-base 0.52.0. **Rulings:** NEED-1731.

### WC-DATA-3 · A provider's id goes in `external_id`

The id a provider gives a record is stored in `external_id`, unique with `account_id` (or with `provider` where the
record has no account). Where the provider's id is unique only inside a container the record belongs to, it is unique
with that container instead: a calendar entry's `external_id` is unique with its `calendar_id`, because the same event
id appears in each calendar that holds a copy of the event, and the calendar is unique with `account_id`. Never in a column named after the provider (`google_id`, `file_id`) and never only in
`metadata`. A second id the provider also uses gets a named column of its own (`ical_uid`).

- **Why:** one place to look for every provider's id, and one unique key to update a record by.
- **Enforced by:** `cli-core: src/store/sqlite/schema.test.ts`.
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
- **Enforced by:** `cli-core: src/store/sqlite/schema.test.ts`.
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
- **Enforced by:** `cli-core: src/store/same-email-join.test.ts` · `cli-core: src/store/files-match.test.ts` ·
  `cli-core: src/store/calendar.test.ts`.
- **Example:** `identity_links` and `identity_link_events` link contacts to persons; `entity_link_events` logs each
  change of the document a file belongs to and of the event a calendar entry or meeting belongs to, and
  `link_reviews` is the owner's review list. A contact saved with an address joins the mail contact of that exact
  address (method `same-email`, the address in `identities.email`), unless the owner separated the two. A Zoom
  meeting at 11:00 next to a 10–11 and an 11–12 event links to neither by time alone.
- **Exceptions:** none.
- **Applies to:** cli-core. **Since:** cli-base 0.52.0. **Rulings:** NEED-1731.

### WC-DATA-7 · A source record the provider stops returning is soft-deleted; its entity and links stay

- **Why:** a sync error or a revoked share must not erase what the owner linked, wrote or searched.
- **Enforced by:** review only.
- **Example:** a calendar sync whose token expired lists again and sets `deleted_at` on entries it did not see; their
  events and meeting links stay.
- **Exceptions:** an entity with no live source record and no owner link may be removed by an explicit owner command.
- **Applies to:** cli-core. **Since:** cli-base 0.52.0. **Rulings:** none.

### WC-DATA-8 · A file joins a document by its place first, then by the content of exactly one document

A `files` row is one item in one place: a file under a local folder or an Obsidian vault, or a Drive file or
folder. It is the source record of a `document` (WC-DATA-2). The same account and `external_id` is the same file. A
new file whose `content_hash` equals that of exactly one document joins it; with two or more such documents, the
file gets a new document and the pair goes to the owner's review list; otherwise it gets a new document.

- **Why:** a file copied or moved between folders stays the one document the owner tagged and linked, and a guess
  between two documents is never made for the owner.
- **Enforced by:** `cli-core: src/store/files-match.test.ts` · `cli-core: src/store/files-area.test.ts`.
- **Example:** a note moved from one vault folder to another keeps its document and its tags, in whichever order
  the two folders sync. The document shows the file the owner pinned, else the one changed most recently.
- **Exceptions:** empty text never joins. A file renamed and edited in one sync is a new document; the old one is
  kept, deleted.
- **Applies to:** cli-core. **Since:** cli-base 0.57.1. **Rulings:** NEED-1731, NEED-1739.

### WC-DATA-9 · A calendar entry joins an event by fixed rules, in order; a deleted one keeps its past

A `calendar_entries` row is one calendar's copy of a single event, a series or one occurrence; it is the source
record of an `event` or `event_series`. An entry joins, in this order: the entry with the same calendar and id; the
same series slot (`original_starts_at`), so an occurrence and its exception are one entry; another calendar's copy
with the same `ical_uid`; a Zoom meeting's event with the same room (`join_key`) at an overlapping time; else a new
event. A calendar the owner owns syncs; one shared with them is listed and does not.

- **Why:** the same meeting in two calendars and in Zoom is one event to the owner, and its history must survive a
  deletion in Google.
- **Enforced by:** `cli-core: src/store/calendar.test.ts`.
- **Example:** a series deleted in Google keeps its past occurrences, marked with `source_deleted_at`; its future
  occurrences are cancelled. Nothing is removed without an explicit owner command.
- **Exceptions:** two Zoom events in one room at that time make no link and one review entry (WC-DATA-6). The
  owner's unlink holds: no rule links the entry again.
- **Applies to:** cli-core. **Since:** cli-base 0.57.1. **Rulings:** NEED-1731, NEED-1764.

## Planned — not built yet

From the Wave 3 requirements, approved by the owner on 2026-10-24 (cli-private
`plans/2026-10-24-open-cli-core-design.md`, sections 3.3–3.6). Each item moves into the rules in the pull request that
builds it.

- **Two persons with one address go to the owner's review list.** Contacts with the same address already join one
  person ([WC-DATA-6](#wc-data-6--every-link-records-how-it-was-made-the-owners-link-wins-ambiguity-makes-no-link)).
- **A CLI's own SQLite file**, opened through a cli-core helper ([Store](store.md), NEED-1737).
- **Later:** renaming `identities` to `contacts`; dropping `documents`' source columns once nothing reads them.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-core `ARCHITECTURE.md`, "The store"](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/ARCHITECTURE.md#the-store)
- cli-private `plans/2026-10-24-open-cli-core-design.md` (private; the rulings NEED-1730 to NEED-1734 are summarised
  above)
