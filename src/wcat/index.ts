/**
 * `wcat`, the umbrella command: `wcat tg …` runs `wcat-tg …`, as `git foo` runs `git-foo`. Its code is here, so every
 * CLI on cli-base carries a copy; the `wcat` file on PATH is a small launcher that starts an installed tool in
 * dispatch mode, and each tool repairs it on start.
 *
 * A CLI's bin imports `wcatStart` from `@wirecat/cli-base/wcat/start`, which loads only Node built-ins; this entry
 * point is the whole library, for WireCat Desktop and for tests.
 */
export { type DescribeAnswer, describeAnswer, parseDescribe, type WcatTool } from "./describe.js"
export { type ListedTool, listTools, runWcat, type WcatContext } from "./dispatch.js"
export { type BinFolder, binFolder, ensureLauncher, type LauncherState } from "./launcher.js"
export {
  BUILT_IN_COMMANDS,
  DESCRIBE_FLAG,
  DISPATCH_FLAG,
  FIRST_PARTY_TOOLS,
  PROGRAM_PREFIX,
  RESERVED_NAMES,
  TOOL_NAME,
} from "./names.js"
export { findOnPath, findTools, type SearchEnv } from "./path.js"
export { parseShim, SHIM_FORMAT, type ShimKind, shimFiles } from "./shim.js"
export {
  addShortcuts,
  installedPrograms,
  listShortcuts,
  removeShortcuts,
  type Shortcut,
  type ShortcutChange,
  type ShortcutStatus,
} from "./shortcuts.js"
export { type WcatStart, type WcatStartIo, wcatStart } from "./start.js"
