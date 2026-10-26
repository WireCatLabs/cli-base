import { expect, it } from "vitest"

it("probe: a deliberately failing test is named in CI", () => {
  expect(1).toBe(2)
})
