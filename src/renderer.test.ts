import { describe, expect, it } from "vitest"
import { createRenderer } from "./renderer.js"
import { captureStreams } from "./streams.js"

// The control character is the point: these assert that no ANSI escape reaches a machine
// stream or a log file.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the test
const ANSI = /\u001b\[/

const render = (format: "json" | "jsonl" | "pretty", color = false) => {
  const streams = captureStreams()
  return { streams, renderer: createRenderer({ format, color, streams }) }
}

describe("json", () => {
  it("puts exactly one value on stdout", () => {
    const { streams, renderer } = render("json")

    renderer.result({ campaigns: [{ id: "c1" }] })

    expect(streams.stdout).toHaveLength(1)
    expect(JSON.parse(streams.stdout[0] ?? "")).toEqual({ campaigns: [{ id: "c1" }] })
  })

  it("keeps every decoration off stdout", () => {
    const { streams, renderer } = render("json")

    renderer.result({ ok: true })
    renderer.success("done")
    renderer.note("something")
    renderer.warn("careful")
    renderer.failure("nope")

    expect(streams.stdout).toHaveLength(1)
    expect(streams.stderr).toEqual(["done", "something", "careful", "nope"])
  })

  it("emits no ANSI even when colour is on", () => {
    const { streams, renderer } = render("json", true)

    renderer.result({ ok: true })
    renderer.success("done")

    expect([...streams.stdout, ...streams.stderr].join("")).not.toMatch(ANSI)
  })
})

describe("jsonl", () => {
  it("gives each item its own line", () => {
    const { streams, renderer } = render("jsonl")

    renderer.stream([{ id: "a" }, { id: "b" }])

    expect(streams.stdout).toEqual(['{"id":"a"}', '{"id":"b"}'])
  })
})

describe("pretty", () => {
  it("still keeps diagnostics off stdout — the invariant is unconditional", () => {
    const { streams, renderer } = render("pretty")

    renderer.result([{ name: "Summer Sale", status: "active" }])
    renderer.success("2 campaigns")

    // Unconditional on purpose: a mode check somewhere is a mode check somebody forgets, and
    // piping human output should still give content rather than commentary.
    expect(streams.stdout.join("\n")).not.toContain("2 campaigns")
    expect(streams.stderr.join("\n")).toContain("2 campaigns")
  })

  it("renders a list of like objects as a table", () => {
    const { streams, renderer } = render("pretty")

    renderer.result([
      { name: "Summer Sale", status: "active" },
      { name: "Retention EU", status: "draft" },
    ])

    const output = streams.stdout.join("\n")
    expect(output).toContain("name")
    expect(output).toContain("Summer Sale")
    expect(output).toContain("draft")
  })

  it("renders a single object as labelled lines", () => {
    const { streams, renderer } = render("pretty")

    renderer.result({ profile: "production", status: "ok" })

    expect(streams.stdout.join("\n")).toMatch(/profile\s+production/)
  })

  it("puts a nested value in its field rather than inventing a layout for it", () => {
    const { streams, renderer } = render("pretty")

    renderer.result({ profile: "production", batch: { attributes: 75 } })

    expect(streams.stdout.join("\n")).toMatch(/batch\s+\{"attributes":75\}/)
  })

  it("falls back to JSON for a value with no shape at all", () => {
    const { streams, renderer } = render("pretty")

    renderer.result("just a string")

    expect(JSON.parse(streams.stdout.join("\n"))).toBe("just a string")
  })

  it("emits no ANSI when colour is off", () => {
    const { streams, renderer } = render("pretty", false)

    renderer.result([{ a: 1 }])

    expect(streams.stdout.join("")).not.toMatch(ANSI)
  })

  it("paints when colour is on, though the process stdout is not a terminal", () => {
    const { streams, renderer } = render("pretty", true)

    renderer.result([{ a: 1 }])

    expect(streams.stdout.join("")).toContain("\u001b[1ma\u001b[22m")
  })
})

describe("text from elsewhere, shown to a person", () => {
  const HOSTILE = "Fam\u001b[2K\u001b[1Gily"

  it("reaches a table, a field list and a diagnostic with its control characters made visible", () => {
    const streams = captureStreams()
    const renderer = createRenderer({ format: "pretty", color: false, streams })
    renderer.result([{ title: HOSTILE }])
    renderer.result({ [HOSTILE]: HOSTILE })
    renderer.warn(HOSTILE)

    const shown = [...streams.stdout, ...streams.stderr].join("\n")
    expect(shown).not.toContain("\u001b")
    expect(shown).toContain("Fam\\x1b[2K\\x1b[1Gily")
  })

  it("is escaped in a diagnostic even when stdout is JSON, because stderr is still read by a person", () => {
    const streams = captureStreams()
    createRenderer({ format: "json", color: false, streams }).warn(HOSTILE)
    expect(streams.stderr.join("")).not.toContain("\u001b")
  })

  it("leaves JSON on stdout byte for byte: JSON.stringify already escapes it, and those bytes are a contract", () => {
    const streams = captureStreams()
    createRenderer({ format: "json", color: false, streams }).result({ title: HOSTILE })
    expect(streams.stdout[0]).toBe(JSON.stringify({ title: HOSTILE }))
  })
})

describe("quiet", () => {
  it("drops notes, successes and warnings, and keeps the failure and the result", () => {
    const streams = captureStreams()
    const renderer = createRenderer({ format: "pretty", color: false, streams, quiet: true })

    renderer.note("n")
    renderer.success("s")
    renderer.warn("w")
    renderer.failure("f")
    renderer.result({ a: 1 })

    expect(streams.stderr).toEqual(["✗ f"])
    expect(streams.stdout).not.toEqual([])
  })
})
