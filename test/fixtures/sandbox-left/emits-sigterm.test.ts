import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { expect, it } from "vitest"

it("keeps its sandbox and its worker after imitating SIGTERM twice", () => {
  const before = process.listenerCount("SIGTERM")
  process.emit("SIGTERM")
  process.emit("SIGTERM")
  expect(existsSync(tmpdir())).toBe(true)
  expect(process.listenerCount("SIGTERM")).toBe(before)
})
