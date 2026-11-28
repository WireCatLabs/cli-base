/**
 * After `tsc`: cli-base's `exports` and the `cli-dev` bin become one pre-bundled build, so a CLI that loads cli-base
 * from the package, and cli-dev loading that CLI, share one instance of it (`bundle-package.ts` says how).
 */
import { fileURLToPath } from "node:url"
import { bundlePackage } from "../dist/dev/bundle-package.js"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
// The entries cli-core imports statically: what a CLI's start loads.
const START = [
  "index",
  "commands",
  "completion",
  "http",
  "query",
  "skill",
  "standards",
  "update",
  "wcat-start",
  "codegen-runtime",
]

const { problems, chunks } = await bundlePackage({
  root: ROOT,
  entries: { "cli-dev": "dist/dev/bin.js" },
  merge: START,
  quiet: ["testing-setup"],
})
if (problems.length > 0) {
  process.stderr.write(`dist/bundle was not built:\n${problems.join("\n")}\n`)
  process.exit(1)
}
process.stdout.write(`dist/bundle: cli-base's exports and cli-dev; ./preload loads ${chunks.length} files\n`)
