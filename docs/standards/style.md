# Style

## Scope

How code and history read: comments say why and only where needed, names, TypeScript habits, and commit messages.

Rule ids on this page are `WC-STYLE-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md). Formatting and the lint rules are on the [Toolchain page](toolchain.md); Biome decides
formatting, so this page does not repeat it.

## Rules

### WC-STYLE-1 · Write a comment only where the code cannot say it, and say why

- **Why:** a comment costs a reader's attention and goes stale silently, so it must carry what the code cannot.
- **Enforced by:** review only.
- **Example:** a comment records a decision, warns about a trap, or names a constraint that is not visible in the
  file: `// A static import would load the whole program before ensureSqlite could swap it.`
- **Exceptions:** none. When in doubt, leave it out; the commit message, the pull request and the tests carry the
  story.
- **Applies to:** all repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STYLE-2 · Do not restate the code, narrate a change or leave old code in comments

- **Why:** these comments repeat what the code or git already says, and they turn false at the next edit.
- **Enforced by:** review only.
- **Example:** no `// increment the counter` above `count++`, no `// fixed the timeout bug`, no section banners, no
  commented-out alternatives. A test gets a clear name, not a paragraph above it.
- **Exceptions:** existing comments in a file you only pass through stay; this rule is for new comments.
- **Applies to:** all repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STYLE-3 · Name files in kebab case, and name a test after what it tests

- **Why:** one naming habit lets a reader and a glob find a module and its test without searching.
- **Enforced by:** review only.
- **Example:** `src/format-markdown.ts` and `src/format-markdown.test.ts`. A test that covers a behaviour across
  modules is named after that behaviour, such as `src/every-failure.test.ts`.
- **Exceptions:** a language whose toolchain reads meaning from a file name keeps that language's form. Go files are
  lower case with underscores, because `go test` finds `_test.go` and the build picks `_unix.go` or `_windows.go`
  by name: wa's `engine/cmd/wa-engine/lock_unix.go` and `convert_test.go`.
- **Applies to:** all repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STYLE-4 · Write functions in the small, and a class only where identity matters

- **Why:** a function that takes its inputs is easy to test and to reuse; a class earns its place by holding state
  that must live together.
- **Enforced by:** review only.
- **Example:** a client that holds a connection and a session is a class. Parsing, mapping and formatting are plain
  functions.
- **Exceptions:** none.
- **Applies to:** all repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STYLE-5 · Narrow a type instead of casting it with `as`

- **Why:** a cast tells the compiler to stop checking, so a renamed field fails at run time instead of at build time.
- **Enforced by:** review only.
- **Example:** narrow with a type guard, `instanceof` or a shape check. A test fixture uses an honest type, such as
  `Omit<T, "x"> & { x: string | null }`, not `as unknown as T`.
- **Exceptions:** `as const` is allowed. A cast that cannot be avoided, because a library is typed too loosely, keeps
  a comment on that line that says why. A cast already on `main` on 17.10.2026, the day cli-base 0.41.0 added this
  rule, may stay until that code is changed; `git blame` shows the date of a line. A cast added later is a finding.
- **Applies to:** all repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STYLE-6 · In a `catch`, narrow with `instanceof` and wrap anything else

- **Why:** a caught value can be anything, and the error model needs a code and a cause to show the right message.
- **Enforced by:** review only.
- **Example:** `e instanceof CliError ? e : new CliError("provider_error", String(e), { cause: e })`. The error codes
  and reasons are on the [Output page](output.md).
- **Exceptions:** none.
- **Applies to:** all repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STYLE-7 · Annotate exports and signatures, and let the rest infer

- **Why:** a redundant annotation is noise, and a hand-written `x is T` is not checked against its body.
- **Enforced by:** review only.
- **Example:** `export function count(items: readonly Item[]): number` with `const total = items.length` inside. In
  `.filter()`, let the callback narrow: `xs.filter((x) => x !== null)`. Write `x is T` only for a named, reused guard
  or a check the compiler cannot follow.
- **Exceptions:** none.
- **Applies to:** all repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STYLE-8 · Inline a type used once, and keep a type beside the code that owns it

- **Why:** a name for a one-off type sends the reader to another place for nothing, and a shared types file collects
  types nobody owns.
- **Enforced by:** review only.
- **Example:** name a type when it is exported or used in three or more places. Keep it in the module that owns it. A
  shared types file holds only a contract between several modules.
- **Exceptions:** none.
- **Applies to:** all repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STYLE-9 · Spread an optional field in, and build an object in one expression

- **Why:** an object built once has one type that the compiler checks; a key added later widens it or fails to
  compile.
- **Enforced by:** review only.
- **Example:** `{ id, ...(signal === undefined ? {} : { signal }) }`, never `{ id, signal: undefined }`. Use
  `=== undefined` when a falsy value is valid. A small helper that returns the optional part is fine.
- **Exceptions:** none. The shared TypeScript config leaves `exactOptionalPropertyTypes` off, so the compiler does not
  force this.
- **Applies to:** all repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-STYLE-10 · Write commit messages and pull request titles as conventional commits

- **Why:** the type and scope tell a reader what changed before they open it, and `!` tells the changelog guard that a
  caller may break.
- **Enforced by:** review only.
- **Example:** `feat(standards): add the verb scan`, `docs(standards): toolchain rules`,
  `feat!: remove the --take alias`. The body says why. A title marked breaking needs a changelog line; the
  changelog rules are on the [Documents page](docs.md). Every WireCat repository merges pull requests by squash
  only, with the pull request's title and body as the commit message; merge commits and rebase merges are off
  (repository settings, set for all repositories on 2026-10-17). So the pull request title is the commit title on
  `main`, and its body is the commit body.
- **Exceptions:** none.
- **Applies to:** all repositories. **Since:** cli-base 0.41.0. **Rulings:** none.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-base `CONVENTIONS.md`, "Code"](https://github.com/WireCatLabs/cli-base/blob/main/docs/dev/CONVENTIONS.md#code)
- [tg-cli TypeScript standards](https://github.com/WireCatLabs/tg-cli/tree/main/agent-os/standards/typescript): no casts,
  inference and optional fields
