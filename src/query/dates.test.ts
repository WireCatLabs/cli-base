import { describe, expect, it } from "vitest"
import { dateEndpoint, dateRange, dayBoundary, timezoneOf, wallTime } from "./dates.js"

const span = { start: 0, end: 10 }
describe("typed calendar boundaries", () => {
  it.each([
    ["2026-03-29", 23, "2026-03-28T23:00:00.000Z"],
    ["2026-10-25", 25, "2026-10-24T22:00:00.000Z"],
  ])("handles DST day %s", (day, hours, expected) => {
    const range = dateRange(day, day, true, true, "Europe/Madrid", span)
    expect(new Date(range.lower as number).toISOString()).toBe(expected)
    expect((Number(range.upper) - Number(range.lower)) / 3600000).toBe(hours)
    expect(range).toMatchObject({ lower_inclusive: true, upper_inclusive: false })
  })
  it("handles inclusive/exclusive day and exact timestamp endpoints separately", () => {
    expect(dateEndpoint("2026-01-01", "UTC", "lower", false, span)).toEqual({
      time: Date.parse("2026-01-02T00:00:00Z"),
      inclusive: true,
    })
    expect(dateEndpoint("2026-01-01", "UTC", "upper", false, span)).toEqual({
      time: Date.parse("2026-01-01T00:00:00Z"),
      inclusive: false,
    })
    expect(dateEndpoint("2026-01-01T10:00:00+02:00", "UTC", "lower", false, span)).toEqual({
      time: Date.parse("2026-01-01T08:00:00Z"),
      inclusive: false,
    })
    expect(dateRange("*", "*", true, true, "UTC", span)).toEqual({ lower_inclusive: true, upper_inclusive: true })
    expect(dayBoundary("2024-02-29", "UTC", true, span)).toBe(Date.parse("2024-03-01T00:00:00Z"))
    expect(dayBoundary("0099-01-01", "UTC", false, span)).toBe(Date.parse("0099-01-01T00:00:00Z"))
    expect(dayBoundary("0000-01-01", "UTC", false, span)).toBe(Date.parse("0000-01-01T00:00:00Z"))
    expect(dayBoundary("9999-12-31", "UTC", true, span)).toBe(Date.parse("+010000-01-01T00:00:00Z"))
  })
  it.each([
    "2026-02-29",
    "2026-13-01",
    "2026-01-32",
    "7w",
    "2026-01-01T25:00:00Z",
    "2026-01-01T10:00:00",
    "2026-02-30T10:00:00Z",
  ])("rejects invalid/unqualified date %s", (value) =>
    expect(() => dateEndpoint(value, "UTC", "lower", true, span)).toThrow(),
  )
  it("refuses nonexistent calendar days and timezone typos", () => {
    expect(() => dayBoundary("2011-12-30", "Pacific/Apia", false, span)).toThrow("does not exist")
    expect(() => timezoneOf("Europe/Imaginary")).toThrow("IANA timezone")
    expect(timezoneOf("UTC")).toBe("UTC")
    expect(timezoneOf()).toBeTruthy()
  })
})

describe("relative dates", () => {
  const now = Date.parse("2026-10-04T10:30:00Z")
  it("reads today and yesterday as calendar days in the timezone", () => {
    expect(dateRange("today", "today", true, true, "Europe/Madrid", span, now)).toEqual({
      lower: Date.parse("2026-10-03T22:00:00Z"),
      upper: Date.parse("2026-10-04T22:00:00Z"),
      lower_inclusive: true,
      upper_inclusive: false,
    })
    expect(dateRange("Yesterday", "yesterday", true, true, "UTC", span, now)).toMatchObject({
      lower: Date.parse("2026-10-03T00:00:00Z"),
      upper: Date.parse("2026-10-04T00:00:00Z"),
    })
  })
  it("reads 30m/2h/7d as that long before now, and a bare one as since then", () => {
    expect(dateRange("7d", "*", true, true, "UTC", span, now)).toMatchObject({ lower: now - 7 * 86_400_000 })
    expect(dateRange("2h", "2h", true, true, "UTC", span, now)).toEqual({
      lower: now - 2 * 3_600_000,
      lower_inclusive: true,
      upper_inclusive: true,
    })
    expect(dateRange("2026-10-01", "30m", true, false, "UTC", span, now)).toMatchObject({ upper: now - 1_800_000 })
  })
  it("still refuses an unknown word", () => {
    expect(() => dateRange("tomorrow", "*", true, true, "UTC", span, now)).toThrow("query.invalid-date")
  })
})

describe("a wall-clock time read in a zone", () => {
  it("reads the same typed time as the same moment whatever the process zone", () => {
    const before = process.env.TZ
    const moments = ["Asia/Vladivostok", "America/Los_Angeles"].map((zone) => {
      process.env.TZ = zone
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
      return wallTime("2026-10-21T16:03", "Europe/Madrid", span)
    })
    process.env.TZ = before
    expect(moments).toEqual([Date.parse("2026-10-21T14:03:00Z"), Date.parse("2026-10-21T14:03:00Z")])
  })
  it("keeps seconds and milliseconds", () => {
    expect(wallTime("2026-01-01T10:00:05.25", "Asia/Vladivostok", span)).toBe(Date.parse("2026-01-01T00:00:05.250Z"))
  })
  it.each([
    ["2026-03-29T02:30", "skipped"],
    ["2026-10-25T02:30", "repeated"],
  ])("refuses %s, which daylight saving %s in Madrid", (value) => {
    expect(() => wallTime(value, "Europe/Madrid", span)).toThrow(/daylight saving/)
  })
  it("refuses a time that is not on the calendar or carries a zone", () => {
    expect(() => wallTime("2026-02-30T10:00", "UTC", span)).toThrow()
    expect(() => wallTime("2026-01-01T10:00Z", "UTC", span)).toThrow()
  })
})
