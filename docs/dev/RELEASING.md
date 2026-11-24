# Releasing

A pull request adds its changelog entries under `## Unreleased`, or in a fragment, `changes/<branch>.md`, under the
changelog's `###` headings; fragments of open pull requests do not conflict with each other.
An Added, Deprecated or "Changed — experimental" entry raises the minor; "Changed — may break callers" or Removed
raises the major from 1.0.0 on and the minor before it; only fixes and document changes raise the patch
([Releases](../standards/releases.md#wc-rel-7--versions-are-xyz-a-break-of-the-stable-api-raises-the-major-from-100-on-and-the-minor-before-it)).
No version pull request is needed: on `main`, run

```sh
bin/release
```

It refuses a dirty tree, a branch other than `main` and a `main` that is not pushed. When npm already
has the version, or a higher one, it lands the next free version on `main` through a pull request and publishes
that. After a version npm has, that is its next patch, raised to the level the new entries need: 1.0.0 with only a
fix is followed by 1.0.1, with an Added by 1.1.0. A version npm does not have but that is not above its latest keeps
its level: the next free major for `x.0.0` from 1.0.0 on, the next minor for `x.y.0`, the next patch otherwise.
A section npm already has keeps its heading: the new version takes the `## Unreleased` section, or a new section,
and the release stops when there is neither an Unreleased entry nor a fragment.
The fragments are collected into the version's section and deleted; when they need a higher level than the number
npm left free, the version is raised to it. A version dated by hand in `package.json` and the
changelog is released as it is, with the fragments merged since collected into it. A pre-release (`1.0.0-rc.1`) is
numbered by hand: when npm has it, the release stops. Then it starts
[`release.yml`](../../.github/workflows/release.yml) and follows it. The workflow runs every check,
publishes through npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers/) — no npm
token in GitHub, and npm attaches provenance — and tags `v<version>` only once npm shows the new version.

npm trusts the workflow **by file name**: the package's Trusted Publisher settings on npmjs.com name
`WireCatLabs` / `cli-base` / `release.yml`. Rename the file and publishing stops until they are updated.

`bin/release --local` is the fallback: it runs the same checks here and publishes with your own npm login. With
`NPM_KEYRING_ACCOUNT` set, it reads the token from the keyring (`secret-tool`, service `npm`, that account) and hands
it to `pnpm publish` as `NPM_TOKEN`, without printing it; a missing entry stops it. The token must be allowed to write
`@wirecat/cli-base`, not only `@wirecat/max-cli`.
