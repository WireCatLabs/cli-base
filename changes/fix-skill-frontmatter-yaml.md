### Added

- **`cli-dev docs-check` refuses a page header YAML cannot read.** It parses each page's `---` header with `yaml`,
  which moves from the development dependencies to the dependencies. An agent that parses a skill's header refuses a
  bad one: wordpress-cli 0.1.0 shipped `description: … site: posts …` unquoted, and cli-docs' sync stopped on it.
