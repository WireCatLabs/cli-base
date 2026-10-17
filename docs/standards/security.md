# Security

<!-- cspell:words SECR zizmor -->

## Scope

How a CLI keeps secrets and private data safe: secrets never in logs, fixtures or argv, the keyring, error text that
never repeats input, the scanners, and how a vulnerability is reported.

Two words used on this page:

- A **secret** is anything that grants access: a session token, a bot token, an API key, a password, a 2FA code, a
  proxy password.
- **Private data** is what people wrote or who they are: message text, chat titles, names, phone numbers.

Rule ids on this page are `WC-SECR-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md).

## Rule template

```markdown
### WC-SECR-<n> · <the rule, in one short sentence>

- **Why:** <one line>.
- **Enforced by:** <check names in backticks, joined by " · ">, or the words "review only".
- **Example:** <a command or a piece of code that keeps the rule>.
- **Exceptions:** <when the rule does not apply>, or "none".
- **Applies to:** <all CLIs, or which ones>. **Since:** cli-base <version>. **Rulings:** <ids>, or "none".
```

## Sources today

These documents explain the rules below in more detail. Where one of them disagrees with this page, this page holds.
The audit procedure stays in cli-testing; this page links it and does not copy it.

- [The security audit method](https://github.com/WireCatLabs/cli-testing/tree/main/docs/security): what an audit
  checks, how a run is done, and where its results go.
- [The organisation's security policy](https://github.com/WireCatLabs/.github/blob/main/SECURITY.md): how to report a
  problem.

## Rules

### WC-SECR-1 · Private data and secrets never reach a log, a fixture or a committed document

Command output is the only place where a message the owner asked to read may appear. A log, a run record, a test
fixture, a document and a commit message never hold message text, a token or a phone number.

- **Why:** a log or a repository is copied and kept far longer than anyone remembers; private data in it is a leak.
- **Enforced by:** `node-ci.yml:secrets`.
- **Example:** a log line says `{ "event": "send", "outcome": "sent", "count": 1 }`, not the text that was sent.
- **Exceptions:** none. The scanners catch secrets of known shapes; message text and names are caught only in review.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-2 · A log keeps only known attribute keys, and hides content keys

A log record writes only the attribute keys in cli-base's list (`LOG_ATTRIBUTE_KEYS`) and the ones a CLI adds by
name. Any other top-level key is written as `[not allowed]`. A key that names content or a secret (`text`, `title`,
`token`, `phone`, `chatTitle`, `accessToken` …) is written as `[redacted]`, at any depth.

- **Why:** redaction is the second line of defence; the first is never handing a secret to a logger.
- **Enforced by:** review only.
- **Example:** `recordLog({ … redact: ["sessionKey"] })` adds a CLI's own secret field to the redacted list.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-3 · Test data is visibly fake, and tests prove it does not leak

Fixtures and examples use values that are clearly synthetic. Data that must stay hidden carries a unique marker, and
a test asserts the marker is absent from output and errors.

- **Why:** a "does not leak" test proves the rule; a convention alone does not.
- **Enforced by:** review only.
- **Example:** `synthetic text 42`, the phone number `+71234567890`, the device id
  `00000000-0000-0000-0000-000000000001`, `your-token-here`; `expect(err).not.toContain(token)`.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-4 · Secrets come from the environment, then the OS keyring, then a private file

cli-base's `Credentials` reads the environment variable first (for CI), then the OS keyring, then a file with mode
`0600`. The keyring service is the command's name. When the config directory comes from the environment, the service
name is scoped to that directory (`isolated: true`).

- **Why:** the keyring is the safest store on the computer, and a throwaway config directory must not overwrite the
  owner's real keyring entry.
- **Enforced by:** review only.
- **Example:** a bot token is read from `MAX_BOT_TOKEN`, then the keyring entry `bot:<profile>`, then the file.
- **Exceptions:** `auto` storage tries the keyring and, when it fails, warns once on stderr and uses the file.
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
- **Exceptions:** none.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-209.

### WC-SECR-9 · A command does not send the CLI's own secret files unless the owner says so

A command that sends a local file refuses known credential files, browser profiles, the WireCat apps' own folders and
the message store. The owner adds `--allow-any-file` to send one anyway.

- **Why:** an agent talked into "send me your config" must not be able to send the session.
- **Enforced by:** review only.
- **Example:** `max work messages send --chat @me --file ~/.config/max-cli/credentials.json` is refused.
- **Exceptions:** ordinary hidden developer folders, such as `.cache` or `.worktrees`, are not refused.
- **Applies to:** messenger CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-274.

### WC-SECR-10 · Private files are written atomically with private modes

A file that holds a secret or private state is written with `writeSecurely`: atomically, mode `0600`, in a directory
created with mode `0700`. A temporary credential file, such as a login QR image, is `0600` and removed in `finally`.
tg's `doctor` reports a wrong mode and prints the `chmod` fix without applying it.

- **Why:** another user on the same computer must not read the session.
- **Enforced by:** review only.
- **Example:** `writeSecurely(path, JSON.stringify(state), 0o600)`.
- **Exceptions:** Windows ignores both modes.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-11 · Text from outside is made safe before a terminal or an agent sees it

Display text and agent text pass through cli-base's sanitizer. It escapes control characters, terminal escapes and
the characters that reverse text direction.

- **Why:** a chat title can hold `\x1b[2K` and overwrite what the tool already printed, or make `invoice‮fdp.exe`
  look like a PDF.
- **Enforced by:** review only.
- **Example:** a title with an escape sequence prints as visible `\x1b` text.
- **Exceptions:** machine output (`--json`) keeps the original strings, as a contract with scripts.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-12 · Nothing goes to an outside model or service without explicit config

Private data goes to an outside AI model only when the owner configured it, through cli-core's one model gateway. A
feature that sends a chat's text asks once for consent and can be turned off per chat. Embeddings use the local model
by default.

- **Why:** messages belong to the people who wrote them; sending them to a third party is the owner's decision.
- **Enforced by:** review only.
- **Example:** reply rewording is off until the profile turns it on, and asks once per profile.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-755, NEED-756, NEED-757, ss:10.

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
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** NEED-293, sc:3.

### WC-SECR-15 · Security work keeps ordinary workflows working

Prefer compatibility over guesses about attacks. Fix a confirmed critical issue at once. A new restriction that is not
critical goes to the owner for review first.

- **Why:** users run VPNs, proxies and unusual DNS; a speculative guard that breaks them gets switched off.
- **Enforced by:** review only.
- **Example:** attachment downloads use the configured transport and normal redirects, with no private-address block
  list.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** sc:3, sc:5, sc:6, sc:8.

### WC-SECR-16 · Secret scanners run on every commit and every pull request

- gitleaks scans staged changes in the pre-commit hook, and the whole history in pull request CI, always with
  `--redact`.
- Biome's `noSecrets` rule runs from the shared preset, off in tests only.
- Before a release, and every month: a dependency audit, zizmor for workflows, CodeQL and a gitleaks scan.
- **Why:** a secret removed in a later commit is still a leaked secret; `--redact` keeps a finding from leaking it
  again into the log.
- **Enforced by:** `node-ci.yml:secrets` · `release-checks.yml` · `pnpm standards:check`.
- **Example:** `gitleaks git --staged --no-banner --redact .`.
- **Exceptions:** the pre-commit hook warns, and does not block, when gitleaks is not installed; CI scans anyway.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-SECR-17 · A gitleaks rule covers each secret shape a CLI handles

A CLI adds a gitleaks rule for each token, device id or personal identifier that the default rules do not know. An
allowlist names synthetic values by value, never a whole file, so the file stays scanned.

- **Why:** the default rules know AWS and GitHub keys, not a messenger's session token.
- **Enforced by:** review only.
- **Example:** max's `.gitleaks.toml` has `max-session-token`, `max-device-identity` and `phone-number-e164`, and
  allows only `+71234567890` and other sanctioned fakes.
- **Exceptions:** `pnpm-lock.yaml` may be allowed by path. Today only max has the phone number rule.
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
