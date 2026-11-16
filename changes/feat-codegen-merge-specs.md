### Added

- **`mergeOpenApi(sources, { title, version })` joins a service's OpenAPI specs into one** before `adaptOpenApi`, for a
  service that publishes one spec per object (HubSpot: 127). Components that differ only in their text are kept once;
  a real difference keeps both, the later one and what refers to it under the source's prefix, with that source's
  references rewritten. A path several sources share is taken once when it is the same; a difference there, a repeated operation id
  or mixed OpenAPI versions stop the merge. OAuth scopes and servers are joined. The report lists each source with its
  URL and the SHA-256 of its downloaded text, and what was merged or renamed, for the CLI's provenance. On HubSpot's 15 CRM specs it gives 156
  operations (version 3) or 203 (2026-09), with one schema renamed.
