import { createHash } from "node:crypto"

/** The hash a snapshot's `provenance.json` keeps, so a hand edit or a changed file stops generation. */
export const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex")

/** A service may send the same description with its keys in another order each time; arrays keep theirs. */
export const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
        )
      : value
