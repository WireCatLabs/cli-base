import type { VocabularyFlag } from "./vocabulary.js"

export const CALENDAR_FLAGS: VocabularyFlag[] = [
  { name: "--end-time", value: "<time>", role: "value", type: "time", meaning: "when it ends" },
  {
    name: "--start-date",
    value: "<date>",
    role: "value",
    type: "time",
    meaning: "the first day of something that lasts whole days, such as an all-day event",
  },
  {
    name: "--end-date",
    value: "<date>",
    role: "value",
    type: "time",
    meaning: "the last day of something that lasts whole days, such as an all-day event",
  },
  { name: "--location", value: "<text>", role: "value", type: "string", meaning: "where it takes place" },
  {
    name: "--attendee",
    value: "<email>",
    role: "value",
    type: "string",
    meaning: "a person invited to the event, by email address; repeat it for more",
  },
  {
    name: "--id",
    value: "<id>",
    role: "value",
    type: "id",
    meaning: "the id to create it with, chosen beforehand, so a retry finds it instead of making a second one",
  },
  {
    name: "--calendar",
    value: "<id>",
    role: "target",
    type: "id",
    meaning: "the calendar it acts on, when the thing is on more than one",
  },
  {
    name: "--repeat",
    value: "<rule>",
    role: "value",
    type: "string",
    meaning: "how it repeats, as an RFC 5545 rule such as FREQ=WEEKLY;BYDAY=MO;COUNT=10",
  },
  {
    name: "--hours",
    value: "<from-to>",
    role: "target",
    type: "string",
    meaning: "the working hours of each day to look in, such as 09:00-17:00, in the owner's time zone",
  },
  {
    name: "--series",
    role: "target",
    type: "switch",
    meaning: "act on the whole repeating event, not only this occurrence",
  },
]
