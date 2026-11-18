/**
 * Turns an official API description into committed code: types, Valibot schemas, an operation
 * manifest and a coverage page. Build-time, apart from the small helpers a CLI reads the generated
 * files with (`identifier`, `requestSchema`), and format-neutral: it parses no file format and
 * adds no runtime dependency. `adaptOpenApi` reads an OpenAPI document and `adaptDiscovery` Google Discovery
 * documents the consumer has parsed, and `adaptGraphql` a GraphQL introspection result; `wpJsonToOpenApi` turns WordPress's REST index into OpenAPI; `upgradeToOpenApi3` brings Swagger 1.2 and 2.0 to OpenAPI 3 through two optional
 * peer dependencies. `fakeApi` serves the generated manifest as a strict fake for a CLI's tests, and `signInRequirements` with
 * `signInPlace` say which sign-in a call needs and where its token goes (Basic included). An adapter from
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
export {
  adaptGraphql,
  GRAPHQL_DELETE_REASON,
  type GraphqlOptions,
  type GraphqlProvenance,
  graphqlDocument,
  INTROSPECTION_QUERY,
  parseSelection,
  readGraphql,
  type Selection,
  syncGraphql,
} from "./graphql.js"
export {
  type GraphqlFake,
  type GraphqlFakeAnswer,
  type GraphqlFakeCall,
  type GraphqlFakeOptions,
  graphqlFake,
  selectionProblems,
} from "./graphql-fake.js"
export { requestSchema } from "./json-schema.js"
export {
  type CoverageOptions,
  coverageGenerator,
  definitionsGenerator,
  examplesGenerator,
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
  GraphqlBinding,
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
export { bindingLabel, identifier, kebab } from "./names.js"
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
export { type SignInPlace, signInPlace, signInRequirements } from "./sign-in.js"
export { API_SKILL_GROUPS, API_SKILL_INDEX, type ApiSkillOptions, apiSkillFiles } from "./skill.js"
export { upgradeToOpenApi3 } from "./swagger.js"
export { typesGenerator } from "./typescript.js"
export { type ValibotOptions, valibotGenerator } from "./valibot.js"
export {
  readWpJson,
  syncWpJson,
  type WpJsonOptions,
  type WpJsonProvenance,
  type WpJsonResult,
  wpJsonToOpenApi,
} from "./wp-json.js"
