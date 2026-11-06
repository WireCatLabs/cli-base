import type { VocabularyFlag } from "./vocabulary.js"

export const CRM_FLAGS: VocabularyFlag[] = [
  {
    name: "--pipeline",
    value: "<pipeline>",
    role: "value",
    type: "string",
    meaning: "a CRM pipeline: pipeline:<id>, or a name only one pipeline has",
  },
  {
    name: "--stage",
    value: "<stage>",
    role: "value",
    type: "string",
    meaning: "a stage of the record's pipeline, by the CRM's id or its name",
  },
  {
    name: "--amount",
    value: "<decimal>",
    role: "value",
    type: "string",
    meaning: "a sum of money as a decimal, such as 1500.50, in --currency",
  },
  { name: "--currency", value: "<code>", role: "value", type: "string", meaning: "an ISO 4217 code, such as EUR" },
  {
    name: "--close-date",
    value: "<date>",
    role: "value",
    type: "time",
    meaning: "the day a deal or lead is expected to close, YYYY-MM-DD",
  },
  {
    name: "--owner",
    value: "<user>",
    role: "value",
    type: "id",
    meaning: "the CRM user a record is assigned to, by the CRM's id",
  },
]
