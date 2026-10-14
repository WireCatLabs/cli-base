import * as v from "valibot"

export const EFFECT_LEVELS = ["none", "read", "write"] as const

/** What running a command touches: the service it talks to, and this machine (files, the keyring, the store). */
export const effectsSchema = v.strictObject({
  remote: v.picklist(EFFECT_LEVELS),
  local: v.picklist(EFFECT_LEVELS),
})

export type Effects = v.InferOutput<typeof effectsSchema>
export type EffectLevel = (typeof EFFECT_LEVELS)[number]

/** Unknown effects count as a write: a command nobody described is never retried or run on its own. */
export const writes = (effects: Effects | undefined): boolean =>
  effects === undefined || effects.remote === "write" || effects.local === "write"
