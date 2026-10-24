import type { SharedContractOverride } from "./contracts.js"
export const TASK_SHELL: readonly SharedContractOverride[] = [
  {
    command: ["show"],
    field: "description",
    before: "show one task",
    after: "show an imported task",
    reason: "This provider reads imported task rows from an explicit source.",
  },
  {
    command: ["show"],
    field: "effects",
    before: {
      local: "read",
      remote: "none",
    },
    after: null,
    reason: "This provider reads imported task rows from an explicit source.",
  },
  {
    command: ["show"],
    field: "output",
    before: {
      entity: "task",
    },
    after: null,
    reason: "This provider reads imported task rows from an explicit source.",
  },
  {
    command: ["show"],
    field: "options",
    before: [
      {
        flags: "--limit <n>",
        description: "maximum rows",
        takes_value: true,
        mandatory: false,
        default: "10",
      },
    ],
    after: [
      {
        flags: "--source <account>",
        description: "explicit stored source",
        takes_value: true,
        mandatory: false,
      },
    ],
    reason: "This provider reads imported task rows from an explicit source.",
  },
]
