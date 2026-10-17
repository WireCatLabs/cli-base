import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["*.test.ts"],
    setupFiles: [fileURLToPath(new URL("../../../src/testing/setup.ts", import.meta.url))],
  },
})
