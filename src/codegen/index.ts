/**
 * Turns an official API description into committed code: types, Valibot schemas, an operation
 * manifest and a coverage page. Build-time, apart from the small helpers a CLI reads the generated
 * files with (`identifier`, `requestSchema`), and format-neutral: it parses no file format and
 * adds no runtime dependency. `adaptOpenApi` reads an OpenAPI document and `adaptDiscovery` Google Discovery
 * documents the consumer has parsed; `upgradeToOpenApi3` brings Swagger 1.2 and 2.0 to OpenAPI 3 through two optional
 * peer dependencies. `fakeApi` serves the generated manifest as a strict fake for a CLI's tests. An adapter from
 * Postman or anything else lives in the consumer.
 */
export {
  adaptDiscovery,
  type DiscoveryMetadata,
  type DiscoveryOptions,
  type DiscoveryProvenance,
  type DiscoveryResult,
  type DiscoveryService,
  readDiscovery,
  type SyncDiscoveryOptions,
  syncDiscovery,
} from "./discovery.js"
export {
  type FakeAnswer,
  type FakeApi,
  type FakeApiOptions,
  type FakeCall,
  fakeApi,
  sampleOf,
  schemaProblems,
} from "./fake.js"
export { requestSchema } from "./json-schema.js"
export {
  type CoverageOptions,
  coverageGenerator,
  definitionsGenerator,
  type ManifestOperation,
  manifestGenerator,
} from "./manifest.js"
export { type MergedSource, type MergeOptions, type MergeReport, mergeOpenApi, type SpecSource } from "./merge.js"
export type {
  ApiBody,
  ApiModel,
  ApiOperation,
  ApiParameter,
  ApiSchema,
  ApiServer,
  Binding,
  CodeGenerator,
  Confidence,
  Discriminator,
  Effect,
  GeneratedArtifact,
  HttpBinding,
  HttpMethod,
  OAuthFlow,
  OperationPermission,
  Override,
  PageParameter,
  Pagination,
  RpcBinding,
  SchemaNode,
  SecurityRequirement,
  SecurityScheme,
  SourceInfo,
  SourceReference,
} from "./model.js"
export { identifier, kebab } from "./names.js"
export { adaptOpenApi, OpenApiError } from "./openapi.js"
export { detectPagination } from "./pagination.js"
export { type PatchedSpec, type PatchSpecOptions, patchSpec, type SpecPatch } from "./patch.js"
export {
  type AuthOverride,
  applyNames,
  applyOverrides,
  applyPagination,
  applyPermissionRule,
  CodegenError,
  type CommandNames,
  type GenerateOptions,
  generate,
  type PermissionRule,
  READING_POST_REASON,
  validateModel,
  type WriteOptions,
  writeArtifacts,
} from "./pipeline.js"
export { API_SKILL_GROUPS, API_SKILL_INDEX, type ApiSkillOptions, apiSkillFiles } from "./skill.js"
export { upgradeToOpenApi3 } from "./swagger.js"
export { typesGenerator } from "./typescript.js"
export { type ValibotOptions, valibotGenerator } from "./valibot.js"
