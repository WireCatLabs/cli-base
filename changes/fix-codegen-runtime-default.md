### Added

- **`/codegen/runtime` exports `Binding`, `HttpBinding`, `RpcBinding` and `Confidence`.** A CLI that reads an
  operation's binding or how far it is trusted no longer imports the experimental `/codegen` for the type.

### Changed — experimental

- **The generated manifest and definitions import their types from `@wirecat/cli-base/codegen/runtime`** when
  `coreImport` is not given, not from `/codegen`. Every type they name is there, and `/codegen/runtime` is part of
  the stable API, so a CLI no longer passes `coreImport` by hand. Regenerating changes that one import line.
