# Releasing

Raise `version` in `package.json` and date the `## Unreleased` section of
[`CHANGELOG.md`](../../CHANGELOG.md) as that version, through a pull request; merge it, then on `main`:

```sh
bin/release
```

It refuses a dirty tree, a branch other than `main` and a `main` that is not pushed. When npm already
has the version, or a higher one, it commits the next free version to `main` — the next minor for
`x.y.0`, the next patch otherwise — renames the changelog heading to match, and publishes that. Then it starts
[`release.yml`](../../.github/workflows/release.yml) and follows it. The workflow runs every check,
publishes through npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers/) — no npm
token in GitHub, and npm attaches provenance — and tags `v<version>` only once npm shows the new version.

npm trusts the workflow **by file name**: the package's Trusted Publisher settings on npmjs.com name
`WireCatLabs` / `cli-base` / `release.yml`. Rename the file and publishing stops until they are updated.

`bin/release --local` is the fallback: it runs the same checks here and publishes with the npm token
from the keyring (`secret-tool`, service `npm`, account `leemour`) without printing it. The token
must be allowed to write `@wirecat/cli-base`, not only `@wirecat/max-cli`.
