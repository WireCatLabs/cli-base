# Modularity and dependency boundaries

This is the shared code-structure standard for WireCat libraries and CLIs. Each repository's
architecture page maps these responsibilities to its actual modules. Apply these rules to new
code and to the responsibility being changed; they do not require unrelated rewrites.

## Put behavior at the lowest appropriate shared layer

| Owner | Responsibility | Must not depend on |
|---|---|---|
| cli-base | General CLI infrastructure: errors, output contracts, commands, query primitives, deadlines and injected machine services | Core domain types, databases, provider clients or application profiles |
| cli-core domain modules | Provider-neutral models, validation, references and narrow capability ports | CLI/MCP runtimes, SQL implementations or provider clients |
| cli-core services | Use cases: coordinate ports, enforce account scope, budgets, cancellation and continuation | Concrete database drivers, provider SDKs or terminal output |
| Persistence adapters | Implement store ports, queries, migrations and transaction boundaries | CLI handlers or provider login flows |
| Shared CLI/MCP adapters | Parse transport input, call a use case and present its documented result | Provider SDKs or duplicated domain policy |
| Provider application | Translate vendor data and errors; select profiles, bind capabilities and own resource lifetimes | Another provider's implementation |

A provider-neutral capability belongs in cli-core even when Zoom is its first consumer. A general
CLI primitive belongs in cli-base only when it does not need domain knowledge. Share an invariant
or a meaningful capability; similar-looking lines alone do not justify a new abstraction.

## Keep dependency direction explicit

Domain contracts describe what a use case needs. Infrastructure implements those contracts; the
application binds implementations at its composition root. Pass the narrow port or callback the
use case consumes, rather than a whole store, service container or application context. Use public
package entry points across module boundaries; do not reach through another module's internals.

Inject clocks, cancellation, network, storage and other machine effects. Importing a module or
enumerating commands/tools must not open an account, database, keyring or connection. The host
owns opening and closing resources and emits the answer after required cleanup has completed.

Handlers translate transport data. Services enforce policy. Adapters translate external data and
perform effects. Keep query interpretation, cursor binding, evidence validation and write policy in
the common use case so CLI and MCP cannot silently implement different behavior.

## Give modules a coherent responsibility

A module should have one reason to change: a domain rule, a use case, a transport mapping or an
infrastructure capability. Split when unrelated policies, different effects or independent consumers
accumulate. Separate validation, orchestration and output mapping when each has substantive logic.
Avoid catch-all `utils`, boolean modes that select unrelated workflows and handlers that also own SQL.

File size is a review signal, not a correctness metric. Around 300 lines of handwritten production
code, check for separable responsibilities; above 500, split coherent responsibilities or explain
in the PR why keeping them together is clearer. These are review guidelines, not automatic lint
limits. Generated code, declarative registries and cohesive test scenarios need separate judgment.
Do not hide complexity in a new barrel, scatter one operation into trivial files or wrap each
function in a class merely to meet a number.

Use small interfaces and composition where implementations vary. A capability's implementations
must honor the same validation, ordering, coverage, cancellation and failure contract. Optional
capabilities must fail explicitly when unavailable; they must not silently broaden a request.
Apply SOLID and Clean Architecture through these boundaries; additional factories, inheritance,
repositories or dependency-injection frameworks need a concrete benefit.

## Review and verification

Before merging a changed capability, check:

- Ownership and imports follow the table; a second provider can bind the same use case without
  importing the first provider.
- CLI and MCP share the substantive policy and result mapping; their handlers stay small.
- Scope, budgets, cursor selection and coverage survive every boundary, including empty pages.
- Resource ownership and cancellation are explicit; uncertain write outcomes remain distinguishable.
- Tests exercise the public behavior with injected effects. Shared adapter contract cases cover
  interchangeable implementations; transport tests cover parsing and presentation differences.

Existing large files are not evidence that new mixed responsibilities belong there. Extract the
part needed for a change when that improves its boundaries, preserve behavior with focused checks,
and record unrelated structural debt separately. A review must distinguish these guidelines from
automatically enforced import, type and lint checks.
