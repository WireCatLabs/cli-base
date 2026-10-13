/**
 * One query language for every list: Lucene syntax over the entity's own fields. The parser is a port of
 * Lucene 9.12.3's; the fields come from the entity schema; `evaluate` is a test oracle, never a list filter.
 */
export { type DateRange, dateEndpoint, dateRange, dayBoundary, timezoneOf } from "./dates.js"
export { type EvaluateOptions, evaluate } from "./evaluate.js"
export {
  FIELD_TYPES,
  type FieldAnnotations,
  type FieldSpec,
  type FieldType,
  OPERATORS_BY_TYPE,
  QUERY_BACKENDS,
  type QueryBackend,
  type QueryRegistry,
  queryFieldsOf,
} from "./fields.js"
export { fieldsHelp, QUERY_SYNTAX } from "./help.js"
export { implicitTextTerms, type ParseOptions, parseLucene } from "./parser.js"
export {
  defineQuery,
  describeQuery,
  exampleProblems,
  type FieldInfo,
  QUERY_REASONS,
  type QueryInfo,
} from "./registry.js"
export {
  type Occur,
  type Operator,
  type Predicate,
  QUERY_LIMITS,
  type QueryAst,
  type QueryContext,
  type QueryNode,
  queryError,
  type Span,
  walkQuery,
} from "./types.js"
export { fieldsNamed, type ValidateOptions, validateQuery } from "./validate.js"
