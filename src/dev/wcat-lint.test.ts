import { describe, expect, it } from "vitest"
import { binNameWarnings, describeWarnings } from "./wcat-lint.js"

describe("the wcat lint warnings", () => {
  it("want every command named wcat-<name>, and no reserved name outside @wirecat", () => {
    expect(binNameWarnings({ name: "@wirecat/tg-cli", bin: { "wcat-tg": "a.js" } })).toEqual([])
    expect(binNameWarnings({ name: "@acme/tg", bin: { "wcat-tg": "a.js" } })).toMatchObject([
      { rule: "wcat-bin-name", target: 'package.json "bin" wcat-tg', message: expect.stringContaining("reserved") },
    ])
    expect(binNameWarnings({ name: "@acme/foo", bin: { "wcat-Foo": "a.js", "wcat-shortcuts": "b.js" } })).toHaveLength(
      2,
    )
    expect(binNameWarnings({ name: "@acme/foo-cli", bin: "a.js" })).toMatchObject([
      { target: 'package.json "bin" foo-cli' },
    ])
    expect(binNameWarnings({})).toEqual([])
  })

  it("want a --wcat-describe answer in the format wcat reads", () => {
    expect(describeWarnings({ status: 0, stdout: '{"wcat_describe":1,"version":"1","description":"d"}' })).toEqual([])
    expect(describeWarnings({ status: 0, stdout: "usage: tool" })).toHaveLength(1)
    expect(describeWarnings({ status: 2, stdout: "" })).toHaveLength(1)
  })
})
