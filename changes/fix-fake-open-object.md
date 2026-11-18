### Fixed

- **A schema's `additionalProperties: true` (or `{}`) stays open.** `adaptOpenApi` dropped it, so `fakeApi` refused
  every field of an object the spec leaves open, such as Attio's records filter and its `$or`, as "no such field".
