import type { VocabularyFlag } from "./vocabulary.js"

export const SCHEDULE_FLAGS: VocabularyFlag[] = [
  {
    name: "--notify-on",
    value: "<when>",
    role: "value",
    type: "choice",
    meaning: "when a scheduled run tells the owner: always, failures or never",
  },
  {
    name: "--deliver-to",
    value: "<route>",
    role: "value",
    type: "string",
    meaning:
      "where a scheduled run's result also goes, by the owner's own CLI: telegram-bot:<profile>/<chat> or " +
      "email:<profile>/<address>; repeat it for more. Not --to, which names who a message is for",
  },
  {
    name: "--max-cost-per-day",
    value: "<usd>",
    role: "budget",
    type: "number",
    meaning: "start no run for the rest of the day once the day's runs cost this much; 0 for no cap",
    unit: "US dollars",
  },
]
