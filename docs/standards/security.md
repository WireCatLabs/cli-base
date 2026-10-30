# Security

<!-- cspell:words zizmor PKCE -->

## Scope

How a CLI keeps secrets and private data safe: secrets never in logs, fixtures or argv, the keyring, error text that
never repeats input, the scanners, workflow hardening, and how a vulnerability is reported.

Two words used on this page:

- A **secret** is anything that grants access: a session token, a bot token, an API key, a password, a 2FA code, a
  proxy password.
- **Private data** is what people wrote or who they are: message text, chat titles, names, phone numbers.

Rule ids on this page are `WC-SECR-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

## Rules

### WC-SECR-1 · Private data and secrets never reach a log, a fixture or a committed document

Command output is the only place where a message the owner asked to read may appear. A log, a run record, a test
fixture, a document and a commit message never hold message text, a token or a phone number — with one exception:
a run record keeps the command line the person typed.

A run record's `argv` keeps the words as typed by default, so the history of what was run can be read back. A secret
in them is always `[redacted]`: the value of an option or argument the CLI marks with cli-core's `secretInput(...)`,
one whose name says token, password, passphrase, secret, credential, cookie, authorization or API key, a password
inside a URL, and a long opaque string. Inside any typed word cli-core also finds a secret by its content and replaces
only the secret: a token of a known format (GitHub `ghp_…`/`github_pat_…`, `sk-…`, Slack `xox…-`, AWS `AKIA…`, Google
`AIza…`, Stripe `sk_`/`rk_`, npm `npm_…`, a Telegram bot token, a JWT, a PEM private key), a `Bearer` or `Basic`
credential, the value of a secret-named pair (`password=…`, `API_TOKEN=…`, `client_secret:…`), a random-looking string
of 20 or more characters
([how often it is caught](https://github.com/WireCatLabs/cli-testing/blob/main/performance/runs/secret-masking/README.md)),
and a phone number. The same search runs on a kept error message. `record_input: false` in the CLI's config masks
every value that may be content, and a
config that will not load masks the same way. A problem report sent to other people (`doctor reports create`) masks
the typed words always.

- **Why:** a log or a repository is copied and kept far longer than anyone remembers; private data in it is a leak.
- **Enforced by:** `node-ci.yml:secrets`.
- **Example:** a log line says `{ "event": "send", "outcome": "sent", "count": 1 }`, not the text that was sent.
  `tg messages send Mom "see you at 5"` is kept in its run as typed; `tg bot api set-webhook --body '{…}'` keeps
  `--body [redacted]`, since cli-core marks `--body` with `secretInput`. A CLI's own option that takes a secret is
  declared `secretInput(new Option("--pin <code>"))` — although under
  [WC-SECR-5](#wc-secr-5--a-secret-is-never-taken-on-the-command-line) such an option should not exist.
- **Exceptions:** a run record's `argv`, as above: messaging CLIs already keep every message in the store, so the
  words typed are not hidden from the owner's own run log. The scanners catch secrets of known shapes; message text
  and names elsewhere are caught only in review.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-1829.

### WC-SECR-2 · A log keeps only known attribute keys, and hides content keys

A log record writes only the attribute keys in cli-base's list (`LOG_ATTRIBUTE_KEYS`) and the ones a CLI adds by
name. Any other top-level key is written as `[not allowed]`. A key that names content or a secret (`text`, `title`,
`token`, `phone`, `chatTitle`, `accessToken` …) is written as `[redacted]`, at any depth.

- **Why:** redaction is the second line of defence; the first is never handing a secret to a logger.
- **Enforced by:** `src/logging.test.ts`.
- **Example:** `recordLog({ … redact: ["sessionKey"] })` adds a CLI's own secret field to the redacted list.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-3 · Merged into [WC-TEST-8](testing.md#wc-test-8--prove-that-content-does-not-leak-with-a-marker-and-visibly-fake-data)

### WC-SECR-4 · Secrets come from the environment, then the OS keyring, then a private file

cli-base's `Credentials` reads the environment variable first (for CI), then the OS keyring, then a file with mode
`0600`. The keyring service is the CLI's app name, `appName` in its identity (`max-cli`, `gcal-cli`, `cli-memo`), not
the command word people type (`max`, `gcal`). A run with moved folders uses the same entry and never deletes it
([WC-SECR-24](#wc-secr-24--a-run-with-moved-folders-shares-the-owners-keyring-entry-and-never-deletes-it)).

- **Why:** the keyring is the safest store on the computer.
- **Enforced by:** `src/credentials.test.ts`.
- **Example:** a bot token is read from `MAX_BOT_TOKEN`, then the keyring entry `bot:<profile>`, then the file.
- **Exceptions:** `auto` storage tries the keyring and, when it fails, warns once on stderr and uses the file. A
  messenger library's own device store, which the library opens as a file and which cannot live in the keyring
  (WhatsApp's `private.db`), is an owner-only file under
  [WC-SECR-10](#wc-secr-10--private-files-are-written-atomically-with-private-modes) instead.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-295.

### WC-SECR-5 · A secret is never taken on the command line

A secret is typed at a terminal, without echo, or piped on stdin. A secret given on the command line is refused with
`validation_error`. It is stored only after the remote side accepted it.

- **Why:** the command line is visible to other processes and kept in shell history; a keyring entry cannot be read
  back to check it.
- **Enforced by:** review only.
- **Example:** cli-core's `readSecret` reads one line from a terminal or a pipe, at most 64 KiB, and prompts on stderr.
  `contacts import` reads phone numbers from stdin, never from the command line.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-203.

### WC-SECR-6 · Error text never repeats a secret or what other people wrote

An error message names what failed and the next step. It never quotes a secret, a parameter the caller passed that
may hold private data, or text from the provider that can quote a chat title or a message. Provider errors are reduced
to their error name, or replaced with fixed wording.

- **Why:** errors reach logs, run records and agents' transcripts.
- **Enforced by:** review only.
- **Example:** tg's error mapper keeps only the provider's error name, and turns a name that tells a person nothing
  into a fixed sentence with the next `tg …` command to run.
- **Exceptions:** the owner's own input that holds no private data, such as a file path, may be named.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-7 · A token stays inside the transport

The address that holds a token is built in one place and never reaches an error, a trace or a rethrown network error.
Text that looks like a token is replaced with `[redacted]`. Attachments carry a file id, never a download address
that contains the token. Proxy credentials are passed as options, never inside a proxy address.

- **Why:** the token is the account or the bot; anything that prints it hands it away.
- **Enforced by:** review only.
- **Example:** a failed Bot API call reports the method and the API's own description with tokens replaced, never
  the request address.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-8 · Phone numbers are masked unless the owner asks for the whole number

Output shows the last four digits (`***1234`). `--show-phone` prints the whole number, on the command line only.

- **Why:** a phone number identifies a person and is the login of a messenger account.
- **Enforced by:** review only.
- **Example:** `max work account show --show-phone`.
- **Exceptions:** an id that is itself the phone number is printed whole, because a masked id cannot be passed back
  to the next command. WhatsApp names a person by a phone-form id while their hidden id (LID) is not known yet; wa
  prints the LID whenever it has one.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-209.

### WC-SECR-9 · A command does not send the CLI's own secret files unless the owner says so

A command that sends a local file refuses known credential files, browser profiles, the WireCat apps' own folders and
the message store. The owner adds `--allow-any-file` to send one anyway.

- **Why:** an agent talked into "send me your config" must not be able to send the session.
- **Enforced by:** review only.
- **Example:** `max work messages send @me --file ~/.config/max-cli/credentials.json` is refused.
- **Exceptions:** ordinary hidden developer folders, such as `.cache` or `.worktrees`, are not refused.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-274.

### WC-SECR-10 · Private files are written atomically with private modes

A file that holds a secret or private state, `config.json` included, is written with `writeSecurely`: atomically, mode `0600`, in a directory
created with mode `0700`. `writeSecurely` takes text or bytes. A
temporary credential file is `0600` and removed in `finally`.
The shared messenger `doctor` reports a wrong mode, the config file and its folder included, and prints the `chmod`
fix without applying it.

- **Why:** another user on the same computer must not read the session.
- **Enforced by:** `src/config.test.ts`.
- **Example:** `writeSecurely(path, JSON.stringify(state), 0o600)`.
- **Exceptions:** Windows ignores both modes.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-11 · Text from outside is made safe before a terminal or an agent sees it

Display text and agent text pass through cli-base's sanitizer. It escapes control characters, terminal escapes and
the characters that reverse text direction.

- **Why:** a chat title can hold `\x1b[2K` and overwrite what the tool already printed, or make `invoice‮fdp.exe`
  look like a PDF.
- **Enforced by:** `src/sanitize.test.ts`.
- **Example:** a title with an escape sequence prints as visible `\x1b` text.
- **Exceptions:** machine output (`--json`) keeps the original strings, as a contract with scripts.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-12 · Nothing goes to an outside model or service without explicit config

Private data goes to an outside AI model only when the owner configured it, through cli-core's one model gateway. A
feature that sends a chat's text asks once for consent and can be turned off per chat. Embeddings use the local model
by default. Nothing is downloaded unasked either: attachment text is extracted from a remote file only with
`--download`, and a meaning search with no model falls back to words and says `meaning: "unavailable"`.

- **Why:** messages belong to the people who wrote them; sending them to a third party is the owner's decision.
- **Enforced by:** review only.
- **Example:** reply rewording is off until the profile turns it on, and asks once per profile.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-545, NEED-552, NEED-755, NEED-756, NEED-757, ss:10.

### WC-SECR-13 · A CLI sends no telemetry

- **Why:** the tool must not report on its owner; for a messenger CLI, extra traffic also stops it looking like the
  official client.
- **Enforced by:** review only.
- **Example:** a pull request that adds a call to a WireCat server, or to an analytics service, is refused in review.
- **Exceptions:** a messenger CLI may later copy what the official client reports, and nothing more.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-16.

### WC-SECR-14 · Certificate checks stay on, and the computer's trust store is never changed

A CLI never turns off TLS verification. A root certificate that a provider needs is trusted inside the process only.

- **Why:** changing the computer's trust store weakens every other program on it.
- **Enforced by:** review only.
- **Example:** for its Bot API calls, max adds the root certificate it ships to that process alone.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-293, sc:5.

### WC-SECR-15 · Security work keeps ordinary workflows working

Prefer compatibility over guesses about attacks. Fix a confirmed critical issue at once. A new restriction that is not
critical goes to the owner for review first.

- **Why:** users run VPNs, proxies and unusual DNS; a speculative guard that breaks them gets switched off.
- **Enforced by:** review only.
- **Example:** attachment downloads use the configured transport and normal redirects, with no private-address block
  list.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** sc:3, sc:5, sc:6, sc:8.

### WC-SECR-16 · Keep the secret scanners on, and run each one with `--redact`

- gitleaks, in the pre-commit hook on staged changes, in the pull request job on the new commits, and on the whole
  history in full validation (on pull requests and on `main`), at release and every month.
- Biome's `noSecrets` rule, from the shared preset, off in tests only
  ([WC-TOOL-10](toolchain.md#wc-tool-10--keep-the-secret-lint-on-and-suppress-a-finding-only-with-its-reason)).
- At release and every month: a dependency audit, zizmor for workflows and CodeQL.
- **Why:** a secret removed in a later commit is still a leaked secret; `--redact` keeps a finding from leaking it
  again into the log.
- **Enforced by:** `node-ci.yml:secrets` · `release-checks.yml` · `standards.yml:standards` · `pnpm standards:check`.
- **Example:** `gitleaks git --staged --no-banner --redact .`. When each scanner runs is on the CI page:
  [WC-CI-1](ci.md#wc-ci-1--run-only-staged-lint-and-a-staged-secret-scan-before-a-commit),
  [WC-CI-3](ci.md#wc-ci-3--run-the-fast-standards-job-on-every-pull-request-and-every-push-to-main),
  [WC-CI-7](ci.md#wc-ci-7--run-full-validation-once-on-each-merge-to-main-on-linux-without-publishing) and
  [WC-CI-10](ci.md#wc-ci-10--run-heavy-security-checks-only-at-release-monthly-or-on-request).
- **Exceptions:** the pre-commit hook warns, and does not block, when gitleaks is not installed; CI scans anyway.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-17 · A gitleaks rule covers each secret shape a CLI handles

A CLI adds a gitleaks rule for each token, device id or personal identifier that the default rules do not know. An
allowlist names synthetic values by value, never a whole file, so the file stays scanned.

- **Why:** the default rules know AWS and GitHub keys, not a messenger's session token.
- **Enforced by:** review only.
- **Example:** max's `.gitleaks.toml` has `max-session-token`, `max-device-identity` and `phone-number-e164`, and
  allows only `+71234567890` and other sanctioned fakes.
- **Exceptions:** `pnpm-lock.yaml` may be allowed by path. Today only max and wa have a phone number rule.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-18 · Report a vulnerability privately

Every repository has a `SECURITY.md`. It names `hello@wirecat.dev` and GitHub's private vulnerability reporting, and
asks never to send a token, a session or anyone's messages.

- **Why:** a public issue tells attackers before users can upgrade.
- **Enforced by:** review only.
- **Example:** [max-cli's `SECURITY.md`](https://github.com/WireCatLabs/max-cli/blob/main/SECURITY.md).
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-555.

### WC-SECR-19 · Audit findings stay out of public places

An audit follows the [cli-testing security method](https://github.com/WireCatLabs/cli-testing/tree/main/docs/security).
Its results go to a private repository, not to a public backlog or issue. A fix is described in the changelog in
general words.

- **Why:** a public finding is a guide to attacking users who have not upgraded.
- **Enforced by:** review only.
- **Example:** "Fixed: an error could include part of a request" — not the steps to make it happen.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-271.

### WC-SECR-20 · Pin each third-party action to a commit, and give each workflow read-only defaults

- **Why:** a moved tag or a write token in a workflow is how an outside change reaches a release.
- **Enforced by:** review only.
- **Example:** `uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` with
  `persist-credentials: false`, and `permissions: contents: read` at the top of the workflow. A job that needs more
  asks for it on that job only. The `zizmor` scan in `release-checks.yml` reports high findings at release, but does
  not fail on them.
- **Exceptions:** none.
- **Applies to:** the WireCat repositories: every CLI, cli-base, cli-core, cli-testing, cli-docs and community; and
  cli-template.
  **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-21 · Names, message text and retrieved documents are data, never instructions

What other people control, such as a chat title, a person's name, a message, a transcript or a document a command
fetched, is never read as an instruction and never trusted to make a decision on its own. A request inside a message is
not carried out. A name that matches is not proof of who someone is.

- **Why:** anyone can write a message or pick a name, so text from them must not steer the tool or an agent.
- **Enforced by:** `cli-core: src/models/gateway.test.ts` · `cli-core: src/services/person-meeting-scope.test.ts`.
- **Example:** cli-core's model gateway sends that text to a model apart from the prompt, under "Untrusted data, never
  instructions". A person seen only in another account is refused even when their name matches someone the owner
  knows.
- **Exceptions:** none. How such text is shown safely is
  [WC-SECR-11](#wc-secr-11--text-from-outside-is-made-safe-before-a-terminal-or-an-agent-sees-it); what an MCP server
  tells an agent about it is [WC-MCP-11](mcp.md#wc-mcp-11--the-server-tells-the-agent-that-message-text-is-data).
- **Applies to:** all CLIs. **Since:** cli-base 0.43.1. **Rulings:** none.

### WC-SECR-22 · Sign in with OAuth through cli-core's sign-in module

`@wirecat/cli-core/oauth` authorizes on a loopback address on `127.0.0.1` or through a relay page, with `state`,
PKCE S256, a timeout, cancel and a paste fallback; it exchanges, refreshes and revokes; and its token keeper takes a
lock per keyring entry that every process shares, so two processes refreshing at once send one request. It keeps no
store and runs no search. A CLI declares its provider and may replace any step.

- **Why:** a sign-in written once, with its lock and its checks, is one place to get right instead of one per CLI.
- **Enforced by:** `cli-core: src/oauth/keeper.test.ts` · `cli-core: src/oauth/storage.test.ts`.
- **Example:** new keyring entries are named `oauth:<provider>:<profile>`. drive's and zm's entries from before the
  module are read and refreshed in the shape they were stored in, so nobody signs in again.
- **Exceptions:** a CLI that replaces a step still keeps the explicit profile, the lock, and tokens that are never
  printed. A CLI that signs in another way (a bot token, a session) does not use the module.
- **Applies to:** every CLI that signs in with OAuth. **Since:** cli-base 0.57.1. **Rulings:** NEED-1734.

### WC-SECR-23 · Meeting passcodes and the query of a join link never reach the store, the output or an agent

- **Why:** a passcode, PIN or join-link query lets anyone who reads the store, a terminal log or an agent's
  transcript join the meeting.
- **Enforced by:** `cli-core: src/store/calendar.test.ts`.
- **Example:** a calendar entry's description loses each line that carries a passcode, password or PIN, and every
  link loses its query string, so `join_url` holds `https://zoom.us/j/123` without `?pwd=`. A meeting is matched by
  its room (`join_key`, such as `zoom:<number>`), never by a link that carries the passcode.
  The same holds for what a command prints and what an MCP tool answers, also when the answer comes straight from
  the provider and never touched the store: a generic API command removes the provider's passcode fields (Google's
  `conferenceData.entryPoints[].passcode`, `pin`, `accessCode`, `password`), the query of every join link and the
  dial sequence after a phone number, and the passcode lines of a description or a location.
- **Exceptions:** a title that names a PIN or a password is kept: it is the meeting's name.
- **Applies to:** cli-core and every CLI that stores or shows meetings or calendar entries. **Since:** cli-base 0.57.1
  (output and agent answers: cli-base 0.65.0). **Rulings:** none (Wave 3 requirements 3.4).

### WC-SECR-24 · A run with moved folders shares the owner's keyring entry and never deletes it

- **Why:** a per-folder keyring entry (`<app>:<config folder>`) left one copy of a sign-in for every test run, agent
  check or worktree, about 1,500 of them in the owner's keyring, and nothing removed them. One entry per computer is
  enough. But a moved run then reaches the owner's real sign-in: `HOME=/tmp/x gcal personal session end` deleted the
  owner's Google sign-in, because only `<PREFIX>_*_DIR` counted as moved (a security review, 2026-10-30).
- **Enforced by:** `src/credentials.test.ts` · `src/paths.test.ts`.
- **Example:** a run is moved when `isMovedRun({ appName, prefix, env })` is true: a `<PREFIX>_CONFIG_DIR`,
  `_STATE_DIR` or `_CACHE_DIR` override, or a `HOME` or XDG folder that puts the default folders anywhere but under
  the account's own home. A CLI passes that as `isolated`. `Credentials` then reads and writes the app's own entry
  (`<app>` / `oauth:<provider>:<profile>`), as a run with the default folders does. With the system keyring, its
  `remove` keeps that entry, warns on stderr and leaves `"keyring"` out of what it returns; a moved `HOME` or XDG
  folder in its `env` counts even when `isolated` is false. A CLI checks `isMovedRun` before it revokes a sign-in at
  the provider, and says so when `session end` removed nothing. A test passes `memoryKeyring()`; a run that must not
  see the keyring at all also runs with `DBUS_SESSION_BUS_ADDRESS` removed, since the keyring is reached over D-Bus.
- **Exceptions:** a write from a moved run, such as `session start` in a worktree, replaces the owner's entry.
- **Applies to:** every CLI, its tests and every agent that runs a CLI. **Since:** the next cli-base release.
  **Rulings:** owner, 2026-10-29 (sign-ins copied per work folder should have reused the existing entry); owner,
  2026-10-30 (share the keyring entry, do not multiply it).

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds. The audit procedure stays in cli-testing; this page links it and does not copy it.

- [The security audit method](https://github.com/WireCatLabs/cli-testing/tree/main/docs/security): what an audit
  checks, how a run is done, and where its results go.
- [cli-core `STANDARD.md`, "External references and our adoption profile"](https://github.com/WireCatLabs/cli-core/blob/022f69fb0acc86f6df05e074ec4df1b911ec94c6/docs/dev/STANDARD.md#external-references-and-our-adoption-profile),
  as it stood before it moved to the handbook (WC-SECR-21)
- [The organisation's security policy](https://github.com/WireCatLabs/.github/blob/main/SECURITY.md): how to report a
  problem.
