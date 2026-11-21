import { afterAll, afterEach } from "vitest"
import { acquireSlot, slotOptions } from "./machine-slot.js"
import { installNetworkGuard } from "./network.js"
import { enterSandbox, installThrowingKeyring, takeKeyringReach } from "./sandbox.js"

/**
 * One vitest `setupFiles` entry for every WireCat CLI: `setupFiles: ["@wirecat/cli-base/testing/setup"]`.
 * Each test file gets its own sandbox directory, removed when the file is done; the real keyring and
 * the network stay out of reach for the whole worker. Off CI, a file first waits for one of the machine's test slots
 * (machine-slot.ts), so suites that several agents start at once share the cores and memory.
 */
const slots = slotOptions()
const release = slots ? await acquireSlot(slots) : () => {}
const sandbox = enterSandbox()
installThrowingKeyring()
installNetworkGuard()

afterEach(() => {
  const stack = takeKeyringReach()
  if (stack) throw new Error(`the test passed only because the keyring fell back to a file:\n${stack}`)
})

afterAll(() => {
  try {
    sandbox.restore()
  } finally {
    release()
  }
})
