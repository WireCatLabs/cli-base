export type Installer = "pnpm" | "npm" | "bun" | "npx" | "checkout" | "unknown"

/**
 * Read from where the running file really lives — `realpath` of the script, not `which`: the
 * command on `PATH` is a shim or a link, and only its target says who installed it. Paths measured
 * on 2026-09-24 by installing into throwaway prefixes.
 */
export const installerOf = (scriptPath: string): Installer => {
  const path = scriptPath.replaceAll("\\", "/")
  if (path.includes("/_npx/")) return "npx"
  if (path.includes("/install/global/node_modules/")) return "bun"
  if (/\/\.?pnpm\//.test(path)) return "pnpm"
  if (path.includes("/node_modules/")) return "npm"
  return path.includes("/dist/") ? "checkout" : "unknown"
}
