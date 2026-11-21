import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { acquireSlot, SLOT_HELD, type SlotOptions, slotOptions } from "./machine-slot.js"

const GB = 1024 ** 3
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const optionsWith = (overrides: Partial<SlotOptions> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "slots-"))
  dirs.push(dir)
  let clock = 0
  const lines: string[] = []
  const options: SlotOptions = {
    dir,
    slots: 2,
    minFreeBytes: 4 * GB,
    maxWaitMs: 10_000,
    pollMs: 500,
    freeBytes: () => 8 * GB,
    alive: () => true,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    log: (line) => lines.push(line),
    ...overrides,
  }
  return { options, lines, dir }
}

describe("machine test slots", () => {
  it("lets as many files run as there are slots, and the next one in when one ends", async () => {
    const { options, lines } = optionsWith({ maxWaitMs: 2_000 })
    const first = await acquireSlot(options)
    const second = await acquireSlot(options)
    const third = await acquireSlot(options)
    expect(lines.at(-1)).toMatch(/running without a slot/)
    third()
    first()
    const again = await acquireSlot(options)
    expect(readdirSync(options.dir)).toHaveLength(2)
    again()
    second()
    expect(readdirSync(options.dir)).toHaveLength(0)
  })

  it("waits while available memory is below the floor, and says why", async () => {
    let free = 1 * GB
    let clock = 0
    const { options, lines } = optionsWith({
      maxWaitMs: 600_000,
      freeBytes: () => free,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
        if (clock >= 40_000) free = 6 * GB
      },
    })
    const release = await acquireSlot(options)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/1\.0 GB available of 4 GB wanted/)
    release()
  })

  it("takes back the slot of a run that died before giving it back", async () => {
    const { options } = optionsWith({ slots: 1, alive: (pid) => pid !== 999_999 })
    writeFileSync(join(options.dir, "slot-0"), "999999 0\n")
    const release = await acquireSlot(options)
    expect(existsSync(join(options.dir, "slot-0"))).toBe(true)
    release()
  })

  it("marks the run while it holds a slot, so a vitest it starts does not wait on it", async () => {
    const { options } = optionsWith()
    const release = await acquireSlot(options)
    expect(process.env[SLOT_HELD]).toBe("1")
    expect(slotOptions({ [SLOT_HELD]: "1" })).toBeUndefined()
    release()
    expect(process.env[SLOT_HELD]).toBeUndefined()
  })

  it("stays out of CI and of a run that turns it off", () => {
    expect(slotOptions({ CI: "true" })).toBeUndefined()
    expect(slotOptions({ WIRECAT_TEST_SLOTS: "0" })).toBeUndefined()
    expect(slotOptions({ WIRECAT_TEST_SLOTS: "3", WIRECAT_TEST_SLOT_DIR: "/x" })).toMatchObject({ slots: 3, dir: "/x" })
  })
})
