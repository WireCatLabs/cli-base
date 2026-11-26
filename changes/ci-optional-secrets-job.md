### Added

- **`node-ci.yml` has a `secrets` input**: false skips its gitleaks scan of the whole history, for a repository whose
  pull request security checks already scan it. It is on by default. Drop `validation / ci / secrets` from the
  ruleset before turning it off, or the required check never reports. WC-CI-3 now lets such a repository keep lint,
  types and secrets in one place ([CI standards](../docs/standards/ci.md#wc-ci-3--run-the-fast-standards-job-on-every-pull-request-and-every-push-to-main)).
