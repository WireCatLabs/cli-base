import { Command } from "commander"
import { expect, it } from "vitest"
import { commandsDocument } from "../commands/index.js"
import { capabilityDifference, readCapabilities } from "./capabilities.js"

const document = (cli: string, links: boolean, approval = false) => {
  const root = new Command(cli)
  if (links) root.command("links")
  const create = root.command("create")
  if (approval) create.option("--approval", "ask for approval")
  return commandsDocument(root, { cli, version: "1", contract: 0 })
}
const manifest = readCapabilities({
  clis: ["a", "b"],
  commands: {
    links: { in: ["a"], reason: "Provider b has one fixed link and no link list." },
    create: {
      in: "all",
      options: { "--approval": { in: ["a"], reason: "Provider b has no approval-based joining." } },
    },
  },
})
it("accepts only the exact declared presence and option availability", () => {
  const documents = [document("a", true, true), document("b", false)]
  expect(capabilityDifference("a+b links: presence", ["a", "b"], documents, manifest)).toBe(true)
  expect(capabilityDifference("a+b create --approval", ["a", "b"], documents, manifest)).toBe(true)
  expect(
    capabilityDifference("a+b links: presence", ["a", "b"], [document("a", false), document("b", false)], manifest),
  ).toBe(false)
  expect(
    capabilityDifference("a+b create --approval", ["a", "b"], [document("a", true), document("b", false)], manifest),
  ).toBe(false)
  expect(capabilityDifference("a+b links: summary", ["a", "b"], documents, manifest)).toBe(false)
  expect(capabilityDifference("a+b unknown: presence", ["a", "b"], documents, manifest)).toBe(false)
  expect(capabilityDifference("a+c links: presence", ["a", "c"], documents, manifest)).toBe(false)
})
it("refuses an unexplained absence declaration", () => {
  const unexplained = readCapabilities({ clis: ["a", "b"], commands: { links: { in: ["a"] } } })
  expect(
    capabilityDifference("a+b links: presence", ["a", "b"], [document("a", true), document("b", false)], unexplained),
  ).toBe(false)
})
