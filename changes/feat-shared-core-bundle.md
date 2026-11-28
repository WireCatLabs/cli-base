### Changed — may break callers

- **`cli-dev bundle` leaves a pre-bundled cli-core outside the CLI's bundle.** When the installed `@wirecat/cli-core`
  ships pre-bundled (cli-core 3.0), cli-core, cli-base and cli-core's peers (commander among them) load from their
  packages, so `dist/bundle` holds only the CLI's code: tg's drops from 16.5 MB to 1.7 MB, and every CLI on one
  cli-core version shares its files. The build now fails when the bundle would hold a copy of one of them, when the CLI
  imports one it does not list in `dependencies`, or when `@wirecat/cli-core` or `@wirecat/cli-base` is a range. With
  today's unbundled cli-core 2.x the bundle is built inside as before: tg's `--help` and `commands --json` stay
  byte-identical. `--private-core` keeps that mode with any cli-core, a pre-bundled one included, and cli-core's
  optional peers (pg, mysql2, ssh2) stay outside in both modes. For a server, and before `upgrade`, the loader also calls a shared package's
  `./preload`. A bin's leading `#!` stays first when the bin is rewritten, and a static import of a native module in a
  bundled package now loads from that package's place instead of failing the build
  ([WC-LAY-10](../docs/standards/layout.md#wc-lay-10--ship-the-bin-as-a-bundle-that-cli-dev-bundle-builds)).
- **cli-base ships pre-bundled.** Every `exports` entry and the `cli-dev` bin are one build in `dist/bundle/`, with the
  modules a start loads merged into one chunk, so a CLI's start reads about a dozen cli-base files instead of a few
  hundred. One build means one copy of each module's state: `cli-dev` running from the unbundled files did not see
  the command labels of a CLI it loaded. The unbundled `dist/**/*.js` files stay. rolldown is a new optional peer.

### Added

- **`bundlePackage` in `@wirecat/cli-base/dev`** pre-bundles a library's `exports` in one esbuild build, keeps each
  module's `import.meta.url`, merges ordered groups of start entries with rolldown, and writes `./preload`, which loads
  every chunk and entry for a server that outlives an upgrade. cli-core 3.0 builds with it.
- **`@wirecat/cli-base/preload`**, the same for cli-base itself.
