### Added

- **`adaptOpenApi` reads the OpenAPI 3.1 unions Notion's API file uses**, which it refused before, so a CLI no longer
  rewrites its spec around them. OpenAPI 3.1 takes these keywords from JSON Schema 2020-12
  ([Schema Object](https://spec.openapis.org/oas/v3.1.0.html#schema-object)):
  - a `{"type": "null"}` member of `oneOf` or `anyOf` makes the union `nullable`; with one member left, the result is
    that member, nullable, under the outer description. `type: [..., "null"]` beside `oneOf` or `anyOf` makes the
    union nullable too, which it silently did not before;
  - `anyOf` is a union, as `oneOf` is: a generated union passes when any member matches, and `oneOf`'s "exactly one" was
    never checked. A schema with both stops generation;
  - an `allOf` with one union member, inline or behind a `$ref`, becomes a union of `allOf`s: A and (B or C) is
    (A and B) or (A and C). A null member of that union is left out, not made nullable: null would also have to pass
    A, which is an object. A reference to a base with a `discriminator` keeps its meaning and is not looked through;
    two union members, or a union that reaches itself this way, stop generation;
  - a field that is only ever `null` (`{"type": "null"}`, `type: ["null"]`) is `unknown`: the model has no null type,
    and accepting more is the same trade as ignoring `not`.

  `exclusiveMinimum`, `exclusiveMaximum` and `maxProperties` are still refused.

### Changed — may break callers

- **Generated types write a map as `{ [key: string]: T }`, not `Record<string, T>`.** A type alias may name itself
  inside an index signature, not inside `Record`, so a JSON value type (string, number, boolean, null, arrays and maps
  of itself) compiles. Every `types.ts` with a map changes, so `generate --check` reports it stale until the CLI
  regenerates once after this bump. The types mean the same.
