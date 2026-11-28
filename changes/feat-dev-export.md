### Added

- **`@wirecat/cli-base/dev` exports the parts of `cli-dev bundle` that another package's own build reuses.**
  `commonJsNames`, `ownPlaces` (now taking one options object, which works with no anchored packages),
  `DEFAULT_EXTERNAL`, `DEFAULT_HARMLESS` and `bundle`. cli-core's pre-bundle script imports them instead of
  copying them. The entry is not in `wirecat.stable`: it may change in a minor release.
