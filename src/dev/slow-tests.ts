/** The slowest tests and files from vitest's JSON report (`--reporter=json`), slowest first. */
export interface VitestReport {
  testResults: {
    name: string
    startTime: number
    endTime: number
    assertionResults: { title: string; duration?: number }[]
  }[]
}

// A fifth of the 15 s limit every repository sets (WC-TEST-20): a slow CI runner takes up to five times as long.
export const SLOW_TEST_MS = 3000

export const slowTests = (report: VitestReport, cwd: string, count: number): { out: string; warning?: string } => {
  const relative = (path: string) => path.slice(cwd.length + 1)
  const tests = report.testResults
    .flatMap((result) =>
      result.assertionResults.map((test) => ({ ms: test.duration ?? 0, file: result.name, test: test.title })),
    )
    .sort((a, b) => b.ms - a.ms)
  const files = report.testResults
    .map((result) => ({ ms: result.endTime - result.startTime, file: result.name }))
    .sort((a, b) => b.ms - a.ms)

  const line = ({ ms, file, test }: (typeof tests)[number]) =>
    `${ms.toFixed(0).padStart(6)} ms  ${relative(file)}  ${test}`
  const total = tests.reduce((sum, test) => sum + test.ms, 0)
  const over = tests.filter((test) => test.ms > SLOW_TEST_MS)
  const out = [
    `${tests.length} tests, ${(total / 1000).toFixed(1)} s of test time\n\nslowest tests:`,
    ...tests.slice(0, count).map(line),
    "\nslowest files:",
    ...files.slice(0, 10).map(({ ms, file }) => `${ms.toFixed(0).padStart(6)} ms  ${relative(file)}`),
  ].join("\n")
  if (over.length === 0) return { out }
  const warning = [
    `warning: ${over.length} ${over.length === 1 ? "test takes" : "tests take"} over ${SLOW_TEST_MS / 1000} s, ` +
      "a fifth of the 15 s test limit; a slow CI runner fails them. Shrink their data (WC-TEST-20):",
    ...over.map(line),
  ].join("\n")
  return { out, warning }
}
