import { afterAll } from "vitest"
import { installNetworkGuard } from "./network.js"
import { enterSandbox, installThrowingKeyring } from "./sandbox.js"

/**
 * One vitest `setupFiles` entry for every WireCat CLI: `setupFiles: ["@wirecat/cli-base/testing/setup"]`.
 * Each test file gets its own sandbox directory, removed when the file is done; the real keyring and
 * the network stay out of reach for the whole worker.
 */
const sandbox = enterSandbox()
installThrowingKeyring()
installNetworkGuard()

afterAll(() => sandbox.restore())
