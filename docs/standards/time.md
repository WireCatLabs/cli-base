# Time

## Scope

How a CLI keeps, exchanges, reads and shows a moment in time: UTC inside, a zone only at the edges.

Rule ids on this page are `WC-TIME-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

Related pages: how a time is written in an answer, next to durations and empty values, is in [Output](output.md)
(`WC-OUT-13`); the store and its migrations are in [Store](store.md); the test sandbox is in [Testing](testing.md).

### Words used here

- **Edge:** a place where a time enters without a zone (a typed date, a file name, a provider field) or leaves for
  a person to read (human text output).
- **Zone in use:** the `--timezone` flag when given, else the zone a setting names, else the computer's IANA zone.

## Rules

### WC-TIME-1 · Store every time in UTC

Every time in a database, cache, cursor, receipt, manifest or exported file is UTC: an ISO 8601 string ending in
`Z`, or epoch milliseconds. Never local wall time, never an offset other than zero.

- **Why:** a stored time read on another computer, or after the owner travels, must mean the same moment.
- **Enforced by:** review only.
- **Example:** `sent_at INTEGER` holding `1792591380000`, or `"2026-10-21T14:03:00.000Z"`.
- **Exceptions:** a column that already holds UTC in another unambiguous form (SQLite's `YYYY-MM-DD HH:MM:SS` from
  `CURRENT_TIMESTAMP`, epoch seconds) stays until its table next migrates; its value still leaves as `WC-TIME-2`
  says. A column that may hold local time gets a forward-only migration, or a proof from history that every writer
  wrote UTC.
- **Applies to:** all CLIs, cli-core and cli-base. **Since:** cli-base 0.48.0. **Rulings:** NEED-1592.

### WC-TIME-2 · Exchange every time in UTC, and add a local time only beside it

JSON, JSONL and MCP output carry each time as an ISO 8601 string ending in `Z`. A display zone may add a second key,
`<key>_local`, with the offset of the zone in use, and `meta.timezone` then names that zone. The local key never
replaces the UTC one.

- **Why:** an agent compares and sorts times from many CLIs; one form, in one zone, needs no guessing.
- **Enforced by:** review only.
- **Example:** `{ "sent_at": "2026-10-21T14:03:00.000Z", "sent_at_local": "2026-10-21T16:03:00.000+02:00" }` with
  `"meta": { "timezone": "Europe/Madrid", … }`.
- **Exceptions:** a provider's own text kept as it came (a mail `Date:` header) goes under `provider_metadata`.
- **Applies to:** all CLIs. **Since:** cli-base 0.48.0. **Rulings:** none.

### WC-TIME-3 · Read a time that has no zone in the zone in use, and say which zone that was

A typed date, a file name or a provider field without a zone is read in the zone in use. The answer says that zone:
`meta.timezone` in machine mode, a short line in human text.

- **Why:** a silent default turns a wall-clock time into the wrong moment; zm stored 111 meetings two hours late when
  file names were read as UTC.
- **Enforced by:** review only.
- **Example:** `zm import 2026-10-21_1603_standup.vtt` on a computer in `Europe/Madrid` stores `14:03Z`, and says
  "file times read in Europe/Madrid".
- **Exceptions:** a provider documented to send UTC without a marker is read as UTC, with a link to that
  documentation next to the code. A local time that daylight saving makes ambiguous or nonexistent is refused, never
  guessed.
- **Applies to:** all CLIs. **Since:** cli-base 0.48.0. **Rulings:** NEED-1592.

### WC-TIME-4 · Show times to a person in the zone in use, and say which zone

- **Why:** a person reads wall-clock time; a UTC time shown without a word reads as local.
- **Enforced by:** review only.
- **Example:** `messages list` prints `16:03` and ends with `times in Europe/Madrid`.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.48.0. **Rulings:** none.

### WC-TIME-5 · A date with no time covers the whole local day, and the answer gives the window in UTC

`--since-time 2026-09-01` starts at local midnight of the zone in use; `--until-time 2026-09-01` ends at the next
local midnight. The answer gives the window it used, in UTC.

- **Why:** "messages of 1 September" means the owner's day, not the UTC day, which starts hours earlier or later.
- **Enforced by:** review only.
- **Example:** in `Asia/Vladivostok`, `--since-time 2026-09-01` gives `meta.window.since` = `2026-08-31T14:00:00.000Z`.
  A thing that has only dates, such as an all-day event (`start_date` 2026-09-01, `end_date` 2026-09-02, the end
  not included), matches by comparing local dates, never UTC moments: it is in the window when its dates overlap the
  local dates the window covers. So in `Europe/Madrid` a filter for 1 September returns the all-day event of
  1 September and not the one of 31 August, whatever zone the event's calendar is in.
- **Exceptions:** none. Known gap, as of 2026-10-27, read from the code and not run: cli-core's event filter
  (`src/store/sqlite/calendar.ts`, the `events` query) compares `starts_at` and `ends_at` with the UTC window for
  all-day events too, and gcal stores an all-day event's start as midnight in its calendar's zone. The two agree
  when the calendar's zone is the zone in use, and miss by a day at the edges when it is not.
- **Applies to:** all CLIs. **Since:** cli-base 0.48.0. **Rulings:** none.

### WC-TIME-6 · Run the tests in a zone that is not UTC, and prove stored values do not depend on it

The shared `node-ci.yml` runs `test:coverage` with `TZ=Asia/Vladivostok` (UTC+10, no daylight saving). Each
repository that stores times has a test that writes the same input under two zones and gets identical stored values.

- **Why:** a suite that runs only in UTC passes for every bug on this page.
- **Enforced by:** `node-ci.yml`.
- **Example:** set `process.env.TZ` to `Asia/Vladivostok`, then to `America/Los_Angeles`, write the same message each
  time, and compare the rows. Node applies a changed `TZ` at once.
- **Exceptions:** a repository that keeps no time skips the second test.
- **Applies to:** all CLIs, cli-core and cli-base. **Since:** cli-base 0.48.0. **Rulings:** none.

### WC-TIME-7 · Give the time and the zone in use where an agent plans from "now"

An answer an agent reads to plan or schedule — a calendar's events, a meeting's preparation, a setup check — carries
`meta.now` (the moment it answered, in UTC), `meta.now_local` (the same moment with the offset of the zone in use) and
`meta.timezone`. cli-base's `clockMeta(now, zone)` builds the three from the command's clock.

- **Why:** a model does not know the time, and guesses "today" and "next Monday" from its training. A widely used Google
  Calendar MCP server gives its agents a `get-current-time` tool for the same reason; an answer that already carries
  the time needs no extra call.
- **Enforced by:** review only.
- **Example:** `gcal personal events list --json` answers with `"meta": { "now": "2026-11-02T15:03:00.000Z",
  "now_local": "2026-11-02T16:03:00.000+01:00", "timezone": "Europe/Madrid", … }`.
- **Exceptions:** an answer about something other than the owner's time (a list of profiles, a tool catalogue)
  leaves them out. The clock is the command's injected one, so a test pins it.
- **Applies to:** all CLIs. **Since:** cli-base 0.72.0. **Rulings:** none.

## Sources

- The owner's ruling of 21.10.2026: every time is stored and exchanged in UTC, in every repository.
- NEED-1592: zm reads file name times in the computer's zone.
