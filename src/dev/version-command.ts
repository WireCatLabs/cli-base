import { parseArgs } from "node:util"
import { versionScript } from "../release/index.js"
import { coreOverrideCheck } from "./core-override.js"

interface Io {
  cwd: string
  out: (text: string) => void
  err: (text: string) => void
}

/** `cli-dev version`: the version in package.json against src/version.ts, then the cli-core override (WC-TOOL-21). */
export const versionCommand = (args: string[], io: Io): number => {
  const { values } = parseArgs({
    args,
    options: {
      sync: { type: "boolean", default: false },
      file: { type: "string", default: "src/version.ts" },
      "cli-core-only": { type: "boolean", default: false },
    },
  })
  let code = 0
  if (!values["cli-core-only"]) {
    const version = versionScript(io.cwd, values.sync ? ["--sync"] : [], values.file)
    code = version.code
    if (code === 0) io.out(version.message)
    else io.err(version.message)
  }
  const { problems, notes } = coreOverrideCheck(io.cwd)
  for (const note of notes) io.out(note)
  for (const problem of problems) io.err(problem)
  return code !== 0 ? code : problems.length > 0 ? 1 : 0
}
