import { afterAll, it } from "vitest"

afterAll(() => {
  throw new Error("this file's afterAll fails")
})

it("passes", () => {})
