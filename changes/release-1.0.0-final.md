### Fixed

- **The family audit lets the CLIs move to cli-core 1.0 one at a time.** cli-core 1.0.0 names an unreadable config
  file `config.unreadable`; a CLI still on 0.x names it `account-rename.config`, and mail-cli before 1.0
  `mail.config-unreadable`. Until every CLI has published on 1.0, the audit saw one failure under two or three names
  and stopped each release. The three combinations are declared differences until 2026-12-09.
