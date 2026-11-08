# Plan: what a CLI touches and which hosts it talks to, in the manifest

Status: **built** on branch `feat/manifest-hosts`; waiting for review. Asked by the owner on 2026-11-08.

## Why

WireCat Desktop adds a third-party CLI it has not reviewed from `contracts/wirecat.json` alone. Before the person
installs it, Desktop should say in plain words what data the CLI touches and which internet hosts it talks to, and it
should flag a CLI that does not follow the rule. Today the manifest lists command paths and effects only: `session
start`, `contacts list` mean nothing to the person, and nothing says where the data goes.

## The shape (additive, still `wcat_manifest: 2`)

Desktop's reader (`wirecat-desktop`, `src-tauri/src/own_tools.rs`, `struct Manifest`) has no `deny_unknown_fields`,
so the new keys are ignored by today's Desktop. Every new key is optional; absent means "not known", never "none".

```json
{
  "commands": [
    {
      "path": ["contacts", "list"],
      "summary": "list contacts",
      "effects": { "remote": "none", "local": "read" },
      "permission": "contacts.read",
      "entity": "contact"
    }
  ],
  "entities": { "contact": { "fields": ["name", "email", "phone"] } },
  "network": { "hosts": ["api.acme.example", "*.cdn.acme.example"], "user_hosts": "the mail server you sign in to" }
}
```

- `commands[].summary`: the command's one-line help, as `--help` shows it; left out when the command has none.
- `commands[].entity`: what the command answers with (`output.entity`, else its query's entity).
- `entities.<name>.fields`: the entity's keys cli-base knows, from every query over it, without relations (they are
  not keys). An entity with no query has no entry: cli-base does not know its fields. Desktop words them itself:
  "Reads contacts: name, email, phone".
- `network.hosts`: every host the CLI contacts, typed by the developer as `hosts` in the identity. `[]` says "no
  network". Lower-case hostnames, no scheme, port or path; one leading `*.` matches subdomains only, and needs two
  labels after it (`*.acme.example`, never `*.com`).
- `network.user_hosts`: hosts the person chooses (an IMAP server, a page they ask to read), in words. The CLI adds
  the configured host to the guard's list at run time.
- `network` absent: the CLI did not say. Desktop flags that.

## The sanctioned HTTP path

`hostFetch({ hosts, fetch?, timeoutMs?, redirects? })` in `@wirecat/cli-base/http`, the entry point that already
holds the HTTP helpers. It returns a `FetchLike`, refuses a host outside `hosts` before anything leaves the machine
(`configuration_error`, naming the host and the `hosts` field), follows redirects itself so every hop is checked
(a 307 to an undeclared host would otherwise resend the body there), drops `authorization` and `cookie` on a hop to
another origin, and bounds the whole exchange with a timeout (30 s by default).

cli-core's `src/fetch/page.ts` stays in cli-core: it is a GET page reader for any public host, with a guard against
private addresses, and it depends on cli-core's readers. A CLI using it declares `user_hosts`.

## The lint

Two `cli-dev lint` rules over the CLI's own `src` (tests, fixtures, the fakes in `src/testing`, `dist` and `node_modules` skipped). Targets carry
no line numbers, so a baseline or an override does not churn:

- `raw-network` (high): an import of `node:http`, `node:https`, `node:http2`, `node:net`, `node:tls`, `node:dgram`
  (with or without `node:`), `undici`, `axios`, `got`, `node-fetch` or `ws` (static, dynamic or `require`; type-only
  imports pass, and so do named imports of only `createServer` or `isIP`), and a call of the global `fetch` or any use
  of `globalThis.fetch`, outside a comment line. Target `src/x.ts node:https`.
- `undeclared-host` (medium): an `http(s)://host` in the source, outside a comment line, that `network.hosts` of the
  shipped `contracts/wirecat.json` does not cover. The `docs_url` host and `example.*`, `*.test`, `*.invalid` are
  skipped. Without a shipped `network.hosts` the rule is skipped and `cli-dev lint` says so. Target: the host alone, the files in the message, so a host named in many files takes one override.

Both go through the baseline and `lint/overrides.json` like every rule. It is a lint, not a sandbox: a dependency, a
computed URL or `eval` passes it. That is why Desktop also scans the tarball and flags what it finds.

## Standards conformance (item 5): recommendation

Do **not** add `standards: { cliBase, lint: "passed" }` to the manifest. The author writes the file, so `"passed"` is
a claim nobody checks, and a cli-base range there repeats `package.json`. What Desktop can check without trusting the
author:

1. `dependencies` in the npm registry's metadata of the version: `@wirecat/cli-base` (and `@wirecat/cli-core`), a
   range Desktop compares to the oldest it supports.
2. npm provenance, when the package was published with it: the registry links the version to the repository and the
   CI run that built it.
3. Its own scan of the tarball with the patterns above.

Nothing is implemented for item 5 beyond the docs.

## What a CLI author changes

Add `hosts` (and `userHosts` when the person picks a host) to the `WCAT` identity, route HTTP through `hostFetch`,
re-run `cli-dev manifest`, and baseline or fix what `raw-network` and `undeclared-host` report.
