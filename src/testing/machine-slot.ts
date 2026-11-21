import { linkSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { freemem, homedir } from "node:os"
import { join } from "node:path"
import { threadId } from "node:worker_threads"

const GB = 1024 ** 3
/** Set in a run that holds a slot, so a vitest it starts does not wait on its parent's slots. */
export const SLOT_HELD = "WIRECAT_TEST_SLOT_HELD"

export interface SlotOptions {
  dir: string
  slots: number
  minFreeBytes: number
  maxWaitMs: number
  pollMs: number
  freeBytes: () => number
  alive: (pid: number) => boolean
  now: () => number
  sleep: (ms: number) => Promise<void>
  log: (line: string) => void
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

const number = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return value !== undefined && value !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/**
 * Several agents run test suites on one machine at once, each with its own workers, and together they took every core
 * and all the memory. A slot is a file in one folder for the whole machine: a test file starts once it holds one and
 * enough memory is available, and gives it back when it ends. CI runs one suite per machine and skips this.
 */
export const slotOptions = (env: NodeJS.ProcessEnv = process.env): SlotOptions | undefined => {
  if (env.CI || env[SLOT_HELD]) return undefined
  const slots = number(env.WIRECAT_TEST_SLOTS, 8)
  if (slots === 0) return undefined
  return {
    dir: env.WIRECAT_TEST_SLOT_DIR ?? join(homedir(), ".cache", "wirecat-test-slots"),
    slots,
    minFreeBytes: number(env.WIRECAT_TEST_MIN_FREE_GB, 4) * GB,
    maxWaitMs: number(env.WIRECAT_TEST_MAX_WAIT_S, 600) * 1000,
    pollMs: 500,
    freeBytes: freemem,
    alive,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => process.stderr.write(`${line}\n`),
  }
}

const holders = (options: SlotOptions): number[] => {
  const pids: number[] = []
  for (const name of readdirSync(options.dir)) {
    if (!name.startsWith("slot-") || name.endsWith(".tmp")) continue
    const path = join(options.dir, name)
    let pid: number
    try {
      pid = Number.parseInt(readFileSync(path, "utf8"), 10)
    } catch {
      continue
    }
    // A run killed before its afterAll, by Ctrl-C or the OOM killer, leaves its slot behind.
    if (Number.isFinite(pid) && options.alive(pid)) pids.push(pid)
    else rmSync(path, { force: true })
  }
  return pids
}

const OWNER = `${process.pid} ${threadId}\n`

const take = (options: SlotOptions): string | undefined => {
  // A slot appears with its owner already written: an empty file read in between would look dead and be taken twice.
  const draft = join(options.dir, `slot-${process.pid}-${threadId}.tmp`)
  writeFileSync(draft, OWNER)
  try {
    for (let index = 0; index < options.slots; index++) {
      const path = join(options.dir, `slot-${index}`)
      try {
        linkSync(draft, path)
        return path
      } catch {}
    }
    return undefined
  } finally {
    rmSync(draft, { force: true })
  }
}

const giveBack = (path: string) => {
  let owner: string | undefined
  try {
    owner = readFileSync(path, "utf8")
  } catch {}
  if (owner === OWNER) rmSync(path, { force: true })
}

/** Waits for a slot and enough free memory; the result gives the slot back. Past maxWaitMs it goes ahead without one. */
export const acquireSlot = async (options: SlotOptions): Promise<() => void> => {
  mkdirSync(options.dir, { recursive: true })
  const started = options.now()
  let told = started
  for (;;) {
    const held = holders(options)
    const free = options.freeBytes()
    if (free >= options.minFreeBytes) {
      const path = take(options)
      if (path) {
        // The worker runs its next test file in the same process, which must ask for a slot again.
        process.env[SLOT_HELD] = "1"
        return () => {
          delete process.env[SLOT_HELD]
          giveBack(path)
        }
      }
    }
    const waited = options.now() - started
    if (waited >= options.maxWaitMs) {
      options.log(`test slots: waited ${Math.round(waited / 1000)} s, running without a slot`)
      return () => {}
    }
    if (options.now() - told >= 30_000) {
      told = options.now()
      options.log(
        `test slots: waiting, ${held.length} of ${options.slots} held (pids ${[...new Set(held)].join(", ") || "none"}), ` +
          `${(free / GB).toFixed(1)} GB available of ${(options.minFreeBytes / GB).toFixed(0)} GB wanted; ` +
          "WIRECAT_TEST_SLOTS=0 turns this off",
      )
    }
    await options.sleep(options.pollMs)
  }
}
