import { readFileSync } from "node:fs"
import crossSpawn from "cross-spawn"
import { parseDescribe, type WcatTool } from "./describe.js"
import { DESCRIBE_FLAG } from "./names.js"

const MAX_ANSWER_BYTES = 64 * 1024

/**
 * Asks one program to describe itself. Any program can sit on PATH under a `wcat-` name, so it gets no input, a time
 * limit and a cap on what it may print, and its failure only means "no description".
 */
export const probeDescribe = (
  path: string,
  { env, timeoutMs }: { env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<Omit<WcatTool, "command"> | undefined> =>
  new Promise((resolve) => {
    let child: ReturnType<typeof crossSpawn>
    try {
      child = crossSpawn(path, [DESCRIBE_FLAG], { stdio: ["ignore", "pipe", "ignore"], env, windowsHide: true })
    } catch {
      resolve(undefined)
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    // On Windows the child is cmd.exe and node is its child: killing cmd.exe leaves node holding the pipe, so "close"
    // could wait for it. Giving up never waits for "close".
    const settle = (answer: Omit<WcatTool, "command"> | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(answer)
    }
    const giveUp = () => {
      child.kill()
      child.stdout?.destroy()
      child.unref()
      settle(undefined)
    }
    const timer = setTimeout(giveUp, timeoutMs)
    child.stdout?.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_ANSWER_BYTES) giveUp()
      else chunks.push(chunk)
    })
    child.once("error", () => settle(undefined))
    child.once("close", (code) =>
      settle(code === 0 ? parseDescribe(Buffer.concat(chunks).toString("utf8")) : undefined),
    )
  })

/** cli-base's own version, read only when `wcat --version` asks; `unknown` from a bundle that left the file behind. */
export const baseVersion = (): string => {
  try {
    const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    const { name, version } = JSON.parse(raw) as { name?: unknown; version?: unknown }
    return name === "@wirecat/cli-base" && typeof version === "string" ? version : "unknown"
  } catch {
    return "unknown"
  }
}
