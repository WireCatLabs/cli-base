# Plan: unique `wcat-<tool>` commands and the `wcat` umbrella

Status: **approved** by the owner on 2026-10-30 (NEED-153 A); step 0 done (option B); step 1 next. Decided so far (journal of WireCat Desktop,
`docs/journal/2026-10-25-desktop-mvp.md`): NEED-148 A, NEED-149 (`wcat-` prefix), NEED-151 A (umbrella, code in
cli-base, no separate package), NEED-152 A (this plan lives here), NEED-153 A (approved; extendable by third-party CLIs; docs, standards and template updated).

## Why

Every tool installs one short command: `tg`, `max`, `wa`, `zm`, `drive`, `memo`. Another program with the same name
can sit earlier on PATH, and then an agent, an AI app or a script runs the wrong program without any sign of it. The
reverse also happens: our `drive` can shadow someone else's, and their scripts run ours. WireCat Desktop also treats
any `tg` on PATH as an installed copy and runs it with `--version`.

An explanation in one app cannot fix this: the caller that gets the wrong program never sees it. The fix is a name
nobody else uses, at every place that calls a tool.

## The shape

```text
wcat-tg personal messages list        the tool itself, a unique name every package installs
wcat tg personal messages list        the umbrella: runs wcat-tg with the rest of the arguments, like git runs git-foo
tg personal messages list             a shortcut, created only when no other program on PATH has the name
```

- **Packages install only `wcat-<tool>`.** `"bin": { "wcat-tg": "dist/bin/tg.js" }`. The short `"tg"` entry goes, after
  the transition below.
- **`wcat` is code in cli-base**, not a package of its own. Every CLI therefore carries a copy of it.
- **Short names are shortcuts**: a link in the same bin folder, made by cli-base (or by WireCat Desktop) only when PATH
  has no program with that name, and never over a file that is not ours.
- **Who writes which form:**
  - docs, examples and agent instructions write `wcat tg …`;
  - an MCP server entry an AI app starts, and WireCat Desktop itself, call `wcat-tg` directly, which skips the
    umbrella's extra process start;
  - a person types whichever they like.

## CLIs that other people build

`wcat` must work for any CLI, not only ours (owner, NEED-153), the way `git` runs any `git-foo` someone writes.

- **Joining takes one thing: a command named `wcat-<name>` on PATH.** No registry, no file to edit, no change to `wcat`.
  `wcat <name> …` then runs it, whoever published it and whatever it is written in.
- **A CLI built on cli-base gets the rest for free:**
  - `npx @wirecat/cli-template new` writes `"bin": { "wcat-<name>": … }`;
  - `wcat --help` shows its one-line description and version;
  - `wcat shortcuts` can give it a short name.
- **How `wcat` learns about a tool:** it runs `wcat-<name> --wcat-describe`. A cli-base CLI answers with JSON: name,
  version, description, docs URL. A program that does not answer is still listed and still runs, just without a
  description. The flag is new and namespaced, so it cannot clash with a tool's own options.
- **Names:**
  - WireCat's own names are reserved in a list in cli-base: `tg`, `max`, `wa`, `zm`, `drive`, `memo`, `email`, plus the
    built-in commands.
  - `wcat` warns when two `wcat-<name>` programs are on PATH, and names both.
  - The standard asks a third-party CLI to pick a name that is not in the reserved list.
- **Built-in commands always win** over a `wcat-<name>` program with the same name, so a third-party program can never
  take over `wcat shortcuts` or `wcat --help`.
- WireCat Desktop keeps showing only the tools in its catalog. Listing third-party `wcat-*` programs there is a
  separate decision.

## How `wcat` gets onto PATH

npm links only the `"bin"` of the package being installed, never of its dependencies, so cli-base's code is not a
command by itself. There are two ways to put it on PATH, and step 0 picks one by measurement.

- **A. Every CLI also declares `"wcat"`** (a three-line `dist/bin/wcat.js` that imports cli-base's dispatcher). This is
  simplest if the package managers accept two packages that declare the same command. I think npm refuses the second
  install ("file already exists"), and pnpm may overwrite instead. If either is true, A is out: installing a second
  tool must never fail or take a file from another package.
- **B. A link that cli-base manages.** On a tool's first run, and from WireCat Desktop, cli-base creates `wcat` in the
  tool's own bin folder when it is missing, pointing at the newest dispatcher among the installed tools. It is the same
  mechanism as the shortcuts, so it is written once.
  - Cost: npm does not know the link. When the tool it points into is uninstalled, the link is left pointing at
    nothing.
  - Handling: on every run, the manager sends a broken link to another tool, or removes it when none is left.

### Chosen: B (step 0, 2026-10-30)

[The measurement](https://github.com/WireCatLabs/cli-testing/blob/main/performance/cli/wcat-umbrella/README.md) rules
out A:

- npm, pnpm and Volta refuse to install a second package that declares `wcat`, on Linux, macOS and Windows. They
  refuse the whole package, so its own `wcat-<tool>` is not installed either.
- bun installs it and silently takes over `wcat`. It then removes `wcat` with whichever package goes first.

B holds on install and upgrade, with three requirements for the link manager:

- **Repair on every run.** After the target package is uninstalled, npm, pnpm and Volta (and Windows under every
  manager) leave the link pointing at nothing.
- **No target inside a versioned folder.** pnpm keeps packages in folders named after the version, so a link into one
  broke on the first upgrade. The `wcat` file is therefore a small generated launcher that starts an installed
  `wcat-<tool>` in dispatch mode, not a link into a package. That tool's cli-base copy does the dispatching.
- **No reliance on a dependency file's mode or path.** cli-base's own files are not a declared bin, so on Linux and
  macOS they may lack the execute permission, and under pnpm their folder changes with every cli-base version.

The extra process start costs a median of 22–32 ms on Linux, 32–45 ms on macOS and 47–72 ms on Windows. That
confirms that MCP entries and WireCat Desktop call `wcat-<tool>` directly.

## The dispatcher

- `wcat <tool> [args…]`: finds `wcat-<tool>` on PATH, starts it with the same arguments, standard streams and
  environment, passes signals through, and exits with its exit code.
- `wcat` alone, or `wcat --help`: lists the `wcat-*` commands found on PATH with their versions. A tool that is not
  installed is named with its install command.
- `wcat --version`: its own version and the list above.
- An unknown tool is a closed error code with the list of installed ones (the output standard applies, `--json` too).
- Not in this plan: `wcat doctor`, `wcat update` and other commands across tools. The dispatcher leaves room for
  them: a built-in name wins over a `wcat-<name>` program, and the built-in list is reserved now.

## Shortcuts

- `wcat shortcuts` lists each installed tool's short name: made, free, or taken by another program (with its path).
- `wcat shortcuts add [tool…]` makes the free ones; `wcat shortcuts remove [tool…]` removes ours only.
- "Ours" means a link into a `@wirecat/*` package. A file or link elsewhere is never touched.
- On Windows npm makes `.cmd` and `.ps1` wrappers, not links. A shortcut there is the same pair of wrappers, marked
  so it can be told apart from someone else's. This needs a Windows test before it ships.

## Transition, in release order

1. **cli-base**: the dispatcher, the shortcut and `wcat` link manager, tests. No CLI changes yet.
2. **Each CLI**: add `"wcat-<tool>"` beside the short name, and bump cli-base. Nothing breaks: both names work.
3. **Callers switch**:
   - agent instructions (skills) and docs to `wcat tg …`;
   - MCP setup commands to `wcat-tg`;
   - WireCat Desktop's catalog `bin` to `wcat-tg`;
   - wirecat.dev, all three languages.
4. **Each CLI drops the short `"bin"`.**
   - Installing that version removes the old `tg` link, as npm removes every link of the version it replaces.
   - The tool's first run, or WireCat Desktop right after the update, makes the shortcut again wherever the name is
     free.
   - People whose `tg` was really ours keep it. People whose `tg` was someone else's get theirs back.

## WireCat Desktop

- Catalog `bin` becomes `wcat-<tool>`.
- A copy counts as installed only if it resolves into `node_modules/@wirecat/<package>`. Another program with the name
  is never run.
- The tool's details show its shortcut (made, free, taken by `<path>`), with a button to add or remove it.
- After a tool update, the app recreates the shortcuts that were made before.

## Step 0: measure before building

The results go to cli-testing (`performance/cli/wcat-umbrella/`), with the script that produced them.

- Two packages declaring the same `"bin"`, installed globally one after the other, with npm, pnpm, bun and Volta, on
  Linux, macOS and Windows. Record whether the second install fails, overwrites or warns. This picks A or B above.
- What `npm uninstall -g` and an upgrade do to a link in the bin folder that npm did not create.
- The time `wcat tg --version` adds over `wcat-tg --version`, as a median of 20 runs.

## Docs, standards and the template

Each change ships in the same PR as the code it describes. A standard that describes behaviour that has not shipped
yet would mislead the people who build on it.

| Where | Change | With step |
| --- | --- | --- |
| cli-base `docs/standards/layout.md` (WC-LAY-2) | The `"bin"` is `wcat-<name>`; no short name in `"bin"` | 2 (new), 4 (rule enforced) |
| cli-base `docs/standards/commands.md` | New rule: answer `--wcat-describe`; don't use a reserved name | 1 |
| cli-base `docs/standards/new-cli.md` | Naming the CLI, the reserved list, joining `wcat` | 1 |
| cli-base `README.md`, `docs/REFERENCE.md`, `CHANGELOG.md`, `docs/roadmap.md` | The dispatcher, the shortcut API | 1 |
| cli-base `cli-dev` lint | A check that `"bin"` keys start with `wcat-` and that `--wcat-describe` answers | 1 (warn), 4 (error) |
| cli-template (`kit/`, skeleton) | `new` writes `wcat-<name>`; `upgrade` moves an existing CLI over | 2 |
| Each CLI's README, docs and agent skill | `wcat tg …` | 3 |
| wirecat.dev (cli-docs), EN/RU/ES | Install pages, every example, a "Build your own CLI for wcat" page | 3 |
| WireCat Desktop | The catalog, detection, shortcuts (section above) | 3 |

## Not decided here

- Whether `max` and `drive` keep those short names or get new ones. Both are common words, but the shortcut rule
  already makes them safe.
- Shared commands across tools (`wcat doctor`, `wcat update`).
