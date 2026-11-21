### Fixed

- **A CLI on cli-core 0.717.0 or later passes `cli-dev audit --family` again.** cli-core 0.715 and 0.716 named an
  unknown profile twice, `account-remove.unknown-profile` and `account-rename.unknown-profile`, and the CLIs published
  on them still do. The audit blamed every CLI that has the first name, including the one being released, so each
  release needed its own exception. It is now a shared difference, reviewed after 2026-12-10, when the family has
  moved to `profile.unknown`.
