### Fixed

- **`cli-dev bundle` drops the `.d.ts` and `.map` files tsc wrote to `dist/`, in a CLI with no `exports`.** Nothing
  imports such a CLI, and no map is read for the bundle a user runs: esbuild writes no maps, and the tsc maps point at
  `src/`, which a CLI does not publish. tg-cli's package loses 204 files and 2.0 MB unpacked, an estimated 20 MB
  across the CLIs. A package with `exports`, such as drive-cli and zoom-cli, keeps them for whoever imports it. Run
  `pnpm typecheck` before `pnpm build`, as CI does: its `--emitDeclarationOnly` writes the `.d.ts` files again.
