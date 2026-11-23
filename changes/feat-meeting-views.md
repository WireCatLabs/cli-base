### Added

- **`summary` and `people` as views.** cli-core's shared `meetings summary <meeting>` and `meetings people <query>`
  then pass `cli-dev lint` with no override in every CLI that mounts the meetings commands. notion-cli, which adds
  Notion AI meeting notes, was the first to hit the finding with cli-base 0.129.0.
