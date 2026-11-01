# Publishing the WireCat CLIs

Where a WireCat CLI is published or listed, how each channel gets it, how to prove a publish happened, and what has
gone wrong on each. The release itself (version, changelog, `bin/release`) is in [Releases](standards/releases.md);
this page starts where the npm package exists.

State as of 2026-11-01. A per-CLI status that changes with every release (latest versions, pending listings) is in
the [status](#status-on-2026-11-01) table at the end; the steps above it change only when a channel does.

## The channels

| Channel | What a user gets | How it gets there | Proof it is there |
|---|---|---|---|
| [npm](#npm) | `@wirecat/<cli>` | `release.yml` job `publish`, npm trusted publishing | `npm view @wirecat/<cli>@<v> dist.attestations.provenance.predicateType` |
| [ClawHub](#clawhub) | skill `wirecat-<cmd>` by `wirecat` | `release.yml` jobs `clawhub-dry-run`, `clawhub` | `https://clawhub.ai/api/v1/skills/wirecat-<cmd>?ownerHandle=wirecat` |
| [MCP Registry](#mcp-registry) | server `dev.wirecat/<repo>` | `release.yml` jobs `mcp-registry-dry-run`, `mcp-registry` | `https://registry.modelcontextprotocol.io/v0/servers?search=dev.wirecat` |
| [Claude Code plugins](#claude-code-plugins) | plugin `wirecat-<cmd>@wirecat` | daily sync pull request in [claude-plugins](https://github.com/WireCatLabs/claude-plugins) | `plugin.json` `version` on its `main` |
| [Hermes and other agents](#hermes-and-other-agents) | the skill, installed locally | `<cli> skill install --for <agent>`; the skill index on wirecat.dev | `https://wirecat.dev/.well-known/skills/index.json` |
| [Glama](#glama) | an MCP server listing | `glama.json` and `Dockerfile`, then the owner on glama.ai | `https://glama.ai/mcp/servers/WireCatLabs/<repo>` |
| [GitHub](#github-releases-and-wiki) | release notes, a wiki copy of `docs/` | `release.yml` job `tag`; `wiki.yml` | the repository's Releases page |
| [wirecat.dev](#wirecatdev) | docs, the skill index, `install.ps1` | cli-docs `deploy.yml` | the site |

Nothing is published to Homebrew, winget, scoop, apt or skills.sh. skills.sh reads GitHub on its own
(`npx skills add WireCatLabs/<repo> --skill <name>`).

### Four version numbers

| Where | Version | Comes from |
|---|---|---|
| npm, git tag, GitHub release, MCP Registry | `x.y.z` ([WC-REL-7](standards/releases.md#wc-rel-7--versions-are-xyz-before-100-a-breaking-change-raises-the-minor)) | `package.json` |
| ClawHub | its own `1.0.x`: the next patch after the latest **public** version, or `--version` | the ClawHub CLI |
| Claude plugin `plugin.json` | the npm version at the skill's last change | claude-plugins `bin/sync-skills` |
| `metadata.version` in an installed or indexed `SKILL.md` | the installed npm version, or cli-docs' `docsRef` | `withVersion` in [`src/skill`](../src/skill/index.ts) |

### A green job is not a publish

Three jobs succeed without publishing anything. Check the channel, not the run:

- `clawhub` succeeds when ClawHub answers `"status": "unchanged"` (the skill did not change) and when it answers
  "Version … already exists" (a warning: see [the pending-version stall](#clawhub-a-version-stuck-in-pending-publication)).
- `mcp-registry` succeeds with a notice when `MCP_REGISTRY_PRIVATE_KEY` is not available to the repository.
- `bin/release` once reported a failure for a run that was green and published (fixed: it now re-watches the run).

## npm

**Each release.** `bin/release` checks the tree, takes the release lock, folds the changelog, finds the next free
version and starts `release.yml` on that commit. The jobs: `checked-commit` → `validation` (packs once) → `checks`
(audit, zizmor, CodeQL) → `build` (checks the tarball's SHA-256, refuses a version npm already has) → `publish` →
`tag`. `publish` has only `id-token: write` and runs in the GitHub environment `npm`; it waits until npm serves the
version's own document. Rules: [WC-REL-1](standards/releases.md#wc-rel-1--release-only-with-binrelease-from-a-clean-main-that-matches-originmain)
to [WC-REL-16](standards/releases.md#wc-rel-16--the-package-ships-only-the-files-it-names). The template's
[`release.yml`](https://github.com/WireCatLabs/cli-template/blob/main/.github/workflows/release.yml) and
[`bin/release`](https://github.com/WireCatLabs/cli-template/blob/main/bin/release) are the reference.

**One-time, per package** (the owner, on npmjs.com):

1. Publish the first version with `bin/release --local`. npm offers trusted publishing only for a package that
   exists. The token comes from `NPM_TOKEN`, the keyring (`service npm`) or `npm login`, and is never printed
   ([WC-REL-14](standards/releases.md#wc-rel-14--binrelease---local-is-the-fallback-and-it-never-prints-the-npm-token)).
2. Package → Settings → Trusted Publisher → GitHub Actions: organization `WireCatLabs`, repository `<repo>`,
   workflow `release.yml`, environment **`npm`**. Each package of a repository gets its own entry (whatsapp-cli has
   seven; cli-core's add-ons name `sqlite.yml` and `onnx.yml`).
3. On GitHub, repository → Settings → Environments → `npm`, with deployment branches limited to `main`.

**Proof.** `npm view @wirecat/<cli>@<v> dist.attestations.provenance.predicateType` prints the SLSA type. A version
published with `--local` has none.

**Known problems.**

| Symptom | Cause | Fix |
|---|---|---|
| `404 Not Found - PUT https://registry.npmjs.org/@wirecat%2f<pkg>` in `publish` | No trusted publisher, or one that names the wrong repository, workflow or environment: after a repository rename, a package name typed in place of the repository, one wrong entry among several packages | Correct the entry on npmjs.com and re-run the failed jobs. `bin/release` prints this hint on that error only |
| `npm view <pkg> version` shows the old version for minutes after a publish | npm's list is cached | Poll `https://registry.npmjs.org/<pkg>/<version>`, as `publish` does |
| A squash or rebase merge moved a changelog line into a released section | GitHub's merge, not caught by the changelog check | `bin/release` runs `cli-dev changelog restore --land` first |
| CodeQL blocked a release for a finding in a test | release checks gate `publish` | Fix the finding; a release never skips its checks ([WC-REL-12](standards/releases.md#wc-rel-12--publish-only-after-full-validation-and-the-release-security-checks-pass)) |

## ClawHub

[ClawHub](https://clawhub.ai) is OpenClaw's skill registry. Each CLI publishes its `skills/<cli>/` folder as the
skill `wirecat-<cmd>` (`wirecat-tg`, `wirecat-whatsapp`) under the publisher `wirecat`. The folder and the skill's
`name` keep the CLI's name, so a local install still writes `skills/<cli>/`; only the ClawHub name has the prefix.
ClawHub shows every skill under MIT-0, whatever the repository's license.

**What the skill needs.** `SKILL.md` frontmatter declares the program and its npm package:

```yaml
metadata:
  openclaw:
    requires:
      bins: [tg]
    install:
      - kind: node
        package: "@wirecat/tg-cli"
        bins: [tg]
```

**Each release.** Two jobs in `release.yml`
([template](https://github.com/WireCatLabs/cli-template/blob/main/.github/workflows/release.yml)):

- `clawhub-dry-run` (dry runs) calls ClawHub's reusable `skill-publish.yml` with `dry_run: true`. That workflow has
  no name input, so it checks the folder's name (`tg-cli`), not `wirecat-tg`.
- `clawhub` (after `tag`) runs ClawHub's own CLI from source at the pinned commit, with the token in a mode-600
  config file: `skill publish skills/<cli> --slug wirecat-<cmd> --owner wirecat --tags latest` plus the source
  repository, commit and path. "already exists" becomes a warning; any other error fails the job.
- The ClawHub commit is pinned twice in each workflow, in `uses:` and in `CLAWHUB_SHA`. Raise both together; a
  dependency bot raises only the first.

**One-time.**

1. The owner signs in to clawhub.ai with GitHub and owns the publisher `wirecat`.
2. The owner creates an API token there and runs
   [`bin/setup-clawhub-token`](https://github.com/WireCatLabs/wirecat-desktop/blob/main/bin/setup-clawhub-token)
   (wirecat-desktop): it reads the token without echo, keeps it in the keyring (`service wirecat account clawhub`)
   and sets the organization secret `CLAWHUB_TOKEN`.
3. After a skill's first publish, set its category on clawhub.ai: messengers → communication, zoom → productivity,
   drive and memo → knowledge.

**Proof.** `https://clawhub.ai/api/v1/skills/wirecat-<cmd>/versions?ownerHandle=wirecat` lists public versions.
`…/versions/<v>?ownerHandle=wirecat` shows `security.status` and each scanner's result.

**By hand.** cli-docs'
[`clawhub.yml`](https://github.com/WireCatLabs/cli-docs/blob/main/.github/workflows/clawhub.yml) (Actions → ClawHub →
Run workflow) runs one command with the organization token: `publish` (a repository's latest release tag, with an
explicit `--version`), `delete`, `undelete` or `inspect`. It lives in a public repository because Actions in the
private ones do not start.

### ClawHub: a version stuck in "pending publication"

- **Symptom.** The publish succeeds, but the version never appears: it waits for ClawHub's security scan, which
  stalls. The next release picks the same number, since only public versions count, and logs "Version 1.0.0 already
  exists" as a warning.
- **What works.** Only ClawHub's maintainers can finish a stalled version, in
  [openclaw/clawhub#4046](https://github.com/openclaw/clawhub/issues/4046). Post one comment per batch with each
  skill's name, version, publish time, `versionId` and `attemptId` (from `inspect`), and ask for the newest attempt
  only. Recovery took from 3 hours to a day.
- **What did not help.** Republishing a higher version by hand (`clawhub.yml publish --version 1.0.1`) stalled the
  same way.

### ClawHub: a "suspicious" rating

- **Symptom.** The skill is public, but its page says "suspicious", and SkillSpector may say "do not install".
- **Where it comes from.** The version's `security.status` follows the AI review (`scanners.llm`): skills that
  SkillSpector flags but the review calls benign show "clean". The review's `summary`, `dimensions` and `guidance`
  name the lines it objects to.
- **Fix.** Change the skill text so it no longer says what the review objects to, and release. Examples: tg 1.0.1
  told the agent to start every search with one that also reads local notes and Drive documents, and called MCP's
  `ask` a confirmation it is not ([tg-cli#801](https://github.com/WireCatLabs/tg-cli/pull/801)). An unchanged skill
  is not republished, so the rating stays until the text changes.

### ClawHub: earlier problems

| Symptom | Cause | Fix |
|---|---|---|
| A reusable workflow could not turn "already exists" into a warning | `uses:` jobs take no shell or `continue-on-error` | The real publish runs ClawHub's CLI in a job of its own |
| Skill names changed three times; a duplicate memo skill; the plugin sync broke twice | Renaming the folder to rename the skill | Keep the folder; name the skill with `--slug wirecat-<cmd>`. ClawHub names are per publisher, so `wirecat/tg-cli` would not collide, but the prefix stays for clarity |
| Hermes's install scan held tg at "caution" | `SKILL.md` named `~/.ssh` | Removed the line ([tg-cli#729](https://github.com/WireCatLabs/tg-cli/pull/729)) |
| `/home` filled up | a ClawHub source clone and package copies left on disk | Remove them after a run |

## MCP Registry

The [official MCP Registry](https://registry.modelcontextprotocol.io) lists each MCP-serving CLI as
`dev.wirecat/<repo>`, run with `npx`.

**What the repository needs.** `server.json` at the root (schema 2025-12-11, `packages[0]` the npm package,
arguments `mcp serve --profiles all`), and `"mcpName": "dev.wirecat/<repo>"` in `package.json`: the registry reads it
from npm's copy of that version, so npm comes first. The `version` in `server.json` is overwritten at publish time.

**Each release.** `mcp-registry-dry-run` runs `mcp-publisher validate`. `mcp-registry` (after `tag`) runs
`mcp-publisher login dns --domain wirecat.dev` with `MCP_REGISTRY_PRIVATE_KEY`, then `mcp-publisher publish`. Both
download `mcp-publisher` 1.8.5 and check its SHA-256. A version cannot be published twice.

**One-time.** The owner ran
[`bin/setup-mcp-registry-key`](https://github.com/WireCatLabs/wirecat-desktop/blob/main/bin/setup-mcp-registry-key)
(wirecat-desktop): an Ed25519 key, its private half in the keyring (`service wirecat account mcp-registry`) and in
the organization secret, its public half as the TXT record `v=MCPv1; k=ed25519; p=<key>` on `wirecat.dev`, at
Cloudflare. The registry's [authentication docs](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx)
describe that login.

**Proof.** `https://registry.modelcontextprotocol.io/v0/servers?search=dev.wirecat` shows each server's latest
version.

The template has no registry jobs; a CLI that serves MCP copies them from tg-cli's `release.yml`.

## Claude Code plugins

[WireCatLabs/claude-plugins](https://github.com/WireCatLabs/claude-plugins) is a plugin marketplace named `wirecat`
with one skill-only plugin per CLI. A user runs `claude plugin marketplace add WireCatLabs/claude-plugins`, then
`claude plugin install wirecat-<cmd>@wirecat`.

**Each release.** Nothing in the CLI's repository. `sync.yml` runs daily: `bin/sync-skills` takes each plugin's
`metadata.source` (`{npm, skill}`), unpacks the latest npm version, copies `skills/<skill>/`, and raises the plugin's
`version` only if the skill changed; `bin/validate` runs `claude plugin validate --strict`. It opens or updates one
pull request, which a person merges.

**Adding a CLI.** A pull request with `plugins/wirecat-<cmd>/`:

- `.claude-plugin/plugin.json` with `metadata.source`, homepage, support, privacy and terms links;
- `.claude-plugin/icon.png`: required by the directory profile; square PNG or JPEG, 512 to 2048 px, under 2 MB;
  all plugins share one;
- `README.md` with "Where your data goes", and `LICENSE`;
- an entry in `.claude-plugin/marketplace.json` and in the README's table.

Then `bin/sync-skills` and `bin/validate`. The icon is taken once, when the plugin is first saved in Anthropic's
developer portal.

**One-time.** The organization allows GitHub Actions to create pull requests (Settings → Actions → General).

**Known problems.** The sync reads the skill folder, so renaming a CLI's `skills/<cli>/` breaks it for every plugin
until `metadata.source.skill` follows. A pull request opened by Actions starts no other workflow, so the sync
validates inline.

## Hermes and other agents

There is no Hermes registry to publish to. A skill reaches an agent three ways:

- **The CLI installs it.** `<cli> skill install --for claude|agents|hermes|all`
  ([`src/skill`](../src/skill/index.ts)). For Hermes it writes `~/.agents/skills/<app>/` and adds that folder to
  Hermes's `skills.external_dirs`, or copies it into `$HERMES_HOME/skills/` when the setting will not take. `all`
  leaves Hermes out, because it changes Hermes's own settings.
- **The index on wirecat.dev.** cli-docs builds `/.well-known/skills/` (the Agent Skills Discovery index Hermes
  reads) from each tool's skill at its `docsRef` in [`tools.json`](https://github.com/WireCatLabs/cli-docs/blob/main/tools.json).
  `hermes skills install well-known:https://wirecat.dev/.well-known/skills/<cli>` installs from it. A new CLI
  appears there once it has a `tools.json` entry; a newer skill once its `docsRef` is raised.
- **Hermes reads GitHub** (`hermes skills tap add WireCatLabs/<repo>`), from `main`.

## Glama

[Glama](https://glama.ai/mcp/servers) lists MCP servers. A repository carries `glama.json` (`maintainers`) and a
`Dockerfile` that installs the npm package and runs `mcp serve` with a made-up profile and no sign-in. The listing
itself is made by the owner on glama.ai, which keeps its own copy of the Dockerfile; its "Make Release" gives the
score that lists such as awesome-mcp-servers ask for. Glama also lists servers it finds on its own: whatsapp-cli is
listed without either file.

## GitHub releases and wiki

`release.yml`'s `tag` job creates `v<version>` and a GitHub release with the changelog section as its notes, after
npm shows the version ([WC-REL-13](standards/releases.md#wc-rel-13--tag-vversion-only-after-npm-shows-that-version)).
cli-docs' `clawhub.yml publish` uses the latest release tag. `wiki.yml` copies `docs/*.md` to the wiki on each push
to `main`; the wiki exists only after its first page is saved by hand on GitHub.

## wirecat.dev

cli-docs' `deploy.yml` builds the site and deploys it to Cloudflare Pages on a push to `main`, daily, and by hand.
It serves the docs, the skill index above, and `install.ps1` for Windows (tg and max). No CLI release triggers it.

## A new CLI

After the [four steps that need a person](standards/new-cli.md#four-steps-that-need-a-person), and before its first
release through CI:

- [ ] npm: GitHub environment `npm` limited to `main`; trusted publisher names environment `npm`
- [ ] ClawHub: `metadata.openclaw` in `SKILL.md`; `CLAWHUB_SLUG: wirecat-<cmd>` in `release.yml`; set the category
  after the first publish
- [ ] MCP Registry, if it serves MCP: `server.json`, `mcpName`, the two jobs copied from tg-cli
- [ ] claude-plugins: a pull request adding `plugins/wirecat-<cmd>/`
- [ ] cli-docs: a `tools.json` entry (also puts the skill in the wirecat.dev index), and the skills page's lists
- [ ] Glama, if it serves MCP: `glama.json` and `Dockerfile`, then the owner lists it
- [ ] wiki, if it has `wiki.yml`: save its first page by hand

## Status on 2026-11-01

| CLI | npm (provenance) | ClawHub | MCP Registry | Plugin | wirecat.dev index | Glama |
|---|---|---|---|---|---|---|
| tg | yes | 1.0.1, suspicious | yes | yes | yes | not listed |
| max | yes | 1.0.3 | yes | yes | yes | not listed |
| whatsapp | yes | 1.0.1 | yes | yes | yes | listed |
| zoom | yes | 1.0.1 | yes | yes | yes | listed |
| drive | yes | 1.0.0 | yes | yes | yes | not listed |
| memo | yes | 1.0.4, suspicious | yes | yes | yes | not listed |
| gcal | yes | 1.0.0 pending ([#4046](https://github.com/openclaw/clawhub/issues/4046)) | no files | yes | yes | no files |
| mail | 0.1.0, no provenance (first version by hand) | not yet; no `metadata.openclaw` | no files | no | no | no files |

Open:

- mail-cli lacks every item of [A new CLI](#a-new-cli) but npm; its first CI release would publish `wirecat-mail` to
  ClawHub without the install block.
- gcal-cli has no MCP Registry files.
- How the ClawHub token is created, its scope and expiry, and how a second member joins `wirecat` are not written
  down.
- `CLAWHUB_TOKEN` and `MCP_REGISTRY_PRIVATE_KEY` are visible to every repository of the organization, so anyone who
  can push to one can publish as WireCat. Kept so while the owner is the only member.
- Whether Anthropic's plugin directory accepted the submission is not recorded.
