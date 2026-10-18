# Layout

## Scope

Where things live in a CLI repository: the folders, the entry points, what the package exports, how large a file may
grow, one job per file, and how a large unit is split.

Rule ids on this page are `WC-LAY-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md). Which layer may import which, and what goes in cli-base, cli-core or the CLI, is on the
[Architecture page](architecture.md). The hard file size cap is a lint rule on the [Toolchain page](toolchain.md).

## Rules

### WC-LAY-1 · Use the shared top-level layout

- **Why:** an agent that knows one WireCat CLI finds its way in the next one without a map.
- **Enforced by:** review only.
- **Example:** a CLI repository has these at its root:
  - `src/`: all code, tests beside it;
  - `bin/`: the repository's own scripts, such as `bin/release` and a wrapper that runs the local build;
  - `scripts/`: development scripts in TypeScript or JavaScript;
  - `docs/`: user pages; `docs/dev/`: developer pages;
  - `lint/`: `baseline/` and `overrides.json` for the command lint;
  - `contracts/`: the offline contract plan and its snapshots;
  - `config/wirecat/`: the shared presets;
  - `skills/`: the agent skill the package ships;
  - `CHANGELOG.md`, `CLAUDE.md`, `SECURITY.md`, `README.md`, `LICENSE`;
  - git-ignored, on the working machine only: `CLEANUP.md`, `HANDOFF.md`, plans and journals.
- **Exceptions:** a folder the CLI has no use for may be missing; memo has no `contracts/` yet. A product folder may
  be added, such as `spec/` for a protocol or API description.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LAY-2 · Start the command from `src/bin/<command>.ts`, and keep that file thin

- **Why:** the start file runs before any error handling exists, so every line in it is a line that can crash without
  a useful message.
- **Enforced by:** review only.
- **Example:** `src/bin/max.ts` is built to `dist/bin/max.js`, which `package.json` names in `"bin"`. It sets up
  crash handling and a quiet exit on a closed pipe, then imports `../program.js` and sets `process.exitCode` to the
  result of `run(argv)`.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LAY-3 · Export `createProgram` from `src/program.ts`

- **Why:** the test matrix, the reference page and the tests build the command tree from this one function, without
  a process.
- **Enforced by:** review only.
- **Example:** `cli-dev test-matrix --program dist/program.js` loads `createProgram` from the built file. Tests call
  `run()` from the same module.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LAY-4 · Put test-only helpers outside the published folder

- **Why:** everything under `src/` of a library is compiled into `dist/` and published, so a test helper there ships
  to every user.
- **Enforced by:** review only.
- **Example:** a helper only cli-base's own tests use goes in `test/`, not in `src/`. A helper that callers also use
  in their own tests is a public entry point instead, such as `@wirecat/cli-base/testing` and the shared test setup
  `@wirecat/cli-base/testing/setup`.
- **Exceptions:** a CLI's colocated `*.test.ts` files stay in `src/`, because its `tsconfig.json` excludes them from
  the build.
- **Applies to:** cli-base, cli-core and cli-testing. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LAY-5 · Add an entry point as an `exports` entry built from `src/<name>/index.ts`

- **Why:** a caller can import only what `exports` names, so each entry point is a public promise that needs its own
  door.
- **Enforced by:** review only.
- **Example:** `"./query": { "types": "./dist/query/index.d.ts", "default": "./dist/query/index.js" }`, built from
  `src/query/index.ts`. The same pull request adds a line to `scripts/smoke.ts` that loads it under Bun.
- **Exceptions:** a CLI that is used only as a command has no `exports`, or only `"."`.
- **Applies to:** cli-base, cli-core and cli-testing. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LAY-6 · Keep generated code in a `generated/` folder, and commit it

- **Why:** a reader and the lint must tell generated code from written code, and a stale generated file must show as
  a diff.
- **Enforced by:** review only.
- **Example:** max keeps its generated protocol wrappers in `src/generated/`. Full validation runs `pnpm generate`
  and then `git diff --exit-code`. The size cap and the secret lint skip `**/generated/**` by path.
- **Exceptions:** a single generated file may use a `.generated.ts` suffix, such as cli-core's
  `migrations.generated.ts`, and is then excluded from Biome by name.
- **Applies to:** all CLIs and libraries that generate code. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LAY-7 · Treat 300 and 500 lines as review signals

- **Why:** size is a sign of mixed jobs, not a proof, so it starts a review question instead of failing a build.
- **Enforced by:** review only.
- **Example:** at about 300 lines of handwritten production code, look for jobs that can be separated. Above 500,
  split them, or say in the pull request why keeping them together is clearer. The hard cap of 1,000 lines is
  [WC-TOOL-13](toolchain.md#wc-tool-13--cap-every-file-at-1000-lines-with-biome).
- **Exceptions:** generated code, declarative registries and cohesive test scenarios get their own judgment. Do not
  meet the number with a new barrel file, an operation scattered into trivial files or a class around each function.
  The signals count handwritten code in any language, Go included; only the 1,000-line cap is TypeScript only.
- **Applies to:** all CLIs and libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LAY-8 · Give each module one reason to change

- **Why:** a module that mixes a domain rule, a use case and a transport mapping changes for three reasons, and
  every change risks the other two.
- **Enforced by:** review only.
- **Example:** split when unrelated policies, different effects or separate consumers collect in one file. Keep
  validation, orchestration and output mapping apart when each has real logic. Do not write a catch-all `utils`
  module, a boolean flag that selects unrelated workflows, or a command handler that also holds SQL. Split a large
  unit along a named seam, and dispatch by lookup, not by a branch per case:
  - the tg adapter is a thin class over feature modules (folders, topics, groups, contacts, login, watch) that share a
    small feature context;
  - the cli-core store is a set of areas, each in its own file ([Store](store.md));
  - the Lucene compiler has one compiler per field, picked from the field registry by name.
- **Exceptions:** do not scatter one operation into trivial files, add a barrel or wrap each function in a class only
  to meet a size limit.
- **Applies to:** all CLIs and the shared packages. **Since:** cli-base 0.41.0. **Rulings:** none.

### WC-LAY-9 · Do not add a new job to a large file because it is already there

- **Why:** an existing large file is not evidence that a mixed responsibility belongs in it.
- **Enforced by:** review only.
- **Example:** extract the part a change needs when that makes its boundary clearer, keep its behaviour with focused
  tests, and record other structural debt in the backlog instead of fixing it in the same pull request.
- **Exceptions:** none.
- **Applies to:** all CLIs and libraries. **Since:** cli-base 0.41.0. **Rulings:** none.

## Sources

These documents explain the rules on this page in more detail. Where one of them disagrees with this page, this page
holds.

- [cli-base `MODULARITY.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/dev/MODULARITY.md)
- [cli-base `ARCHITECTURE.md`](https://github.com/WireCatLabs/cli-base/blob/main/docs/dev/ARCHITECTURE.md)
