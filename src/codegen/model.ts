/**
 * The model every generator reads, whatever the source was: an OpenAPI file, a Postman collection,
 * a scraped reference page. An adapter produces this from a document already parsed into plain
 * values: `adaptOpenApi` for OpenAPI and `adaptDiscovery` for Google Discovery here, the rest in the
 * consumer. Nothing here reads YAML or a file.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD"

/** How much the source promises. A Postman example is not a contract and must never become one. */
export type Confidence = "contract" | "example" | "inferred" | "override"

/**
 * `undefined` in an adapter's output means "the source did not say". Generation refuses to run
 * until an override classifies it — a write mistaken for a read is the expensive mistake.
 */
export type Effect = "read" | "write" | "destructive"

export interface HttpBinding {
  kind: "http"
  method: HttpMethod
  path: string
}

/** Every call is the same HTTP shape and only the name differs, as in the Telegram Bot API. */
export interface RpcBinding {
  kind: "rpc"
  name: string
}

/**
 * One field of a GraphQL schema's `Query` or `Mutation`. The request is one document, built by `graphqlDocument` from
 * the field, its variables' GraphQL types and a selection; the answer is `data.<field>`.
 */
export interface GraphqlBinding {
  kind: "graphql"
  operation: "query" | "mutation"
  field: string
  /** Each argument's GraphQL type as written in the schema: `{ id: "String!", filter: "IssueFilter" }`. */
  variables: Readonly<Record<string, string>>
  /** The default selection: scalars, and `{ id }` of each object, one level deep; a connection's `nodes` and `pageInfo`. */
  selection: string
}

export type Binding = HttpBinding | RpcBinding | GraphqlBinding

interface SchemaCommon {
  sensitive?: boolean
  description?: string
  nullable?: boolean
  deprecated?: boolean
  default?: unknown
}

export type SchemaNode = SchemaCommon &
  (
    | { type: "ref"; ref: string }
    | {
        type: "string"
        format?: "binary" | "file-reference"
        enum?: readonly string[]
        minLength?: number
        maxLength?: number
        pattern?: string
      }
    | { type: "integer"; format?: "int32" | "int64"; minimum?: number; maximum?: number; enum?: readonly number[] }
    | { type: "number"; minimum?: number; maximum?: number }
    | { type: "boolean"; enum?: readonly boolean[] }
    | { type: "array"; items: SchemaNode; minItems?: number; maxItems?: number; uniqueItems?: boolean }
    | {
        type: "object"
        properties: Readonly<Record<string, SchemaNode>>
        required: readonly string[]
        additionalProperties?: SchemaNode
      }
    | { type: "union"; of: readonly SchemaNode[] }
    /** Inheritance: every member must resolve to an object, and the fields are merged. */
    | { type: "allOf"; of: readonly SchemaNode[] }
    /**
     * Only where the source itself says "anything", or a field that is only ever `null`, which this has no type for.
     * An adapter never falls back to this.
     */
    | { type: "unknown" }
  )

/**
 * A base type with subtypes chosen by one property, OpenAPI's `discriminator`. Referenced from
 * inside an `allOf` it means the base's own fields; referenced anywhere else, one of the subtypes.
 */
export interface Discriminator {
  property: string
  mapping: Readonly<Record<string, string>>
}

export interface ApiSchema {
  id: string
  schema: SchemaNode
  discriminator?: Discriminator
}

export interface ApiParameter {
  name: string
  in: "path" | "query" | "header" | "body"
  sensitive?: boolean
  required: boolean
  description?: string
  schema: SchemaNode
}

export interface ApiBody {
  confidence: Confidence
  required: boolean
  /** How the body travels when it is not JSON: `multipart/form-data` for a file upload, or a form. */
  contentType?: string
  schema?: SchemaNode
  example?: unknown
}

export interface SourceReference {
  /** Where in the source this came from, for a reviewer: a JSON pointer, a folder path. */
  location: string
}

export interface ApiOperation {
  /** The source's own id where it has one. Never re-derived when it does. */
  id: string
  /** Set by `generate`'s `names`; otherwise the command is the kebab-case id. */
  command?: string
  binding: Binding
  summary?: string
  description?: string
  tags: readonly string[]
  parameters: readonly ApiParameter[]
  requestBody?: ApiBody
  response?: ApiBody
  effect?: Effect
  /** Why `effect` is not what the HTTP method says: a default rule or an override. Listed on the coverage page. */
  effectReason?: string
  /** Which security requirements the operation has, when it differs from the document's; `[]` is "none". */
  security?: readonly SecurityRequirement[]
  /** How to ask for the next page, set by `generate`'s `pagination` detection or an override. */
  pagination?: Pagination
  /** `detected`, or `override: <reason>`, for the coverage page. */
  paginationSource?: string
  /** Set by `generate`'s `permissions` rule: the CLI's own keys a call must pass, beside `api.<operation>`. */
  permissions?: readonly OperationPermission[]
  deprecated?: boolean
  source: SourceReference
}

/** A request parameter or a top-level body field. */
export interface PageParameter {
  in: "query" | "body"
  name: string
}

/**
 * How an operation pages, for an executor that reads every page (`--all`). Answer fields are dotted paths into the
 * answer: `next_cursor`, `paging.next.after`, `_embedded.items`.
 */
export type Pagination =
  | {
      style: "cursor"
      /** Where the next request carries the cursor. */
      cursor: PageParameter
      /** Where the answer holds the next cursor; absent or empty on the last page. */
      next: string
      items?: string
      /** A boolean the answer sets to false on the last page, where the service has one. */
      hasMore?: string
      limit?: PageParameter
    }
  | { style: "offset"; offset: PageParameter; limit?: PageParameter; items: string; total?: string }
  | {
      style: "page"
      page: PageParameter
      limit?: PageParameter
      /** `""` when the answer itself is the list, as WordPress's. */
      items: string
      total?: string
      /** The first page's number, where the source says it (WordPress counts from 1): `--all` then needs none given. */
      start?: number
      /** A response header holding the number of pages, as WordPress's `X-WP-TotalPages`: that page is the last. */
      pagesHeader?: string
    }
  /** The answer holds the next page's whole URL. */
  | { style: "link"; next: string; items?: string }

/**
 * A key a call must pass: always, or, when `body`, `query` or `values` is given, only when one of those flags is `true`
 * or one of those fields holds one of its values.
 */
export interface OperationPermission {
  key: string
  /** Top-level request body fields. */
  body?: readonly string[]
  /** Query parameters. */
  query?: readonly string[]
  /**
   * A top-level body field or query parameter of this name holding one of these values: `{ status: ["publish"] }`.
   * Both places count, as a service that merges them (WordPress) publishes from either.
   */
  values?: Readonly<Record<string, readonly string[]>>
  /**
   * The key does not apply when the call itself sets a field to one of these: `{ status: ["draft", "pending", "private"] }` keeps
   * a draft's date change free. A call that leaves the field out still needs the key, as the stored value is unknown.
   */
  unless?: Readonly<Record<string, readonly string[]>>
}

/** The scheme names an operation needs, each with its OAuth scopes; one requirement of the list is enough. */
export type SecurityRequirement = Readonly<Record<string, readonly string[]>>

export interface OAuthFlow {
  authorizationUrl?: string
  tokenUrl?: string
  refreshUrl?: string
  scopes: Readonly<Record<string, string>>
}

/** OpenAPI's Security Scheme Object, with only the fields of its type. */
export interface SecurityScheme {
  type: "apiKey" | "http" | "oauth2" | "openIdConnect" | "mutualTLS"
  description?: string
  name?: string
  in?: "query" | "header" | "cookie"
  scheme?: string
  bearerFormat?: string
  flows?: Readonly<Partial<Record<"implicit" | "password" | "clientCredentials" | "authorizationCode", OAuthFlow>>>
  openIdConnectUrl?: string
}

export interface ApiServer {
  url: string
  description?: string
  variables?: Readonly<Record<string, { default: string; enum?: readonly string[]; description?: string }>>
}

export interface SourceInfo {
  kind: "openapi" | "postman" | "other"
  version?: string
  sourceUrl?: string
  sourceRevision?: string
}

export interface ApiModel {
  source: SourceInfo
  operations: readonly ApiOperation[]
  schemas: readonly ApiSchema[]
  servers?: readonly ApiServer[]
  securitySchemes?: Readonly<Record<string, SecurityScheme>>
  /** The document's default requirements, which an operation's own `security` replaces. */
  security?: readonly SecurityRequirement[]
  /** Set when `generate`'s `auth` replaced the source's sign-in: its reason, for the coverage page. */
  securityReason?: string
}

export interface Override {
  effect?: Effect
  /** How the operation pages, where detection misses or misreads it; `null` says it does not page. */
  pagination?: Pagination | null
  /** Required: an override nobody can explain is one nobody dares remove. */
  reason: string
}

export interface GeneratedArtifact {
  path: string
  content: string
}

export type CodeGenerator = (model: ApiModel) => GeneratedArtifact[]
