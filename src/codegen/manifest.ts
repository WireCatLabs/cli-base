import type {
  ApiModel,
  ApiOperation,
  Binding,
  CodeGenerator,
  Confidence,
  Effect,
  OperationPermission,
  Pagination,
  SchemaNode,
  SecurityRequirement,
} from "./model.js"
import { kebab } from "./names.js"
import { SchemaTree } from "./tree.js"

/** One operation as a CLI reads it at run time: enough to build a command, validate input and guard a write. */
export interface ManifestOperation {
  id: string
  command: string
  binding: Binding
  effect: Effect
  summary?: string
  description?: string
  tags: readonly string[]
  deprecated?: boolean
  parameters: readonly {
    name: string
    in: "path" | "query" | "header" | "body"
    sensitive?: boolean
    required: boolean
    description?: string
    schema: SchemaNode
  }[]
  request?: { required: boolean; confidence: Confidence; schema?: string; contentType?: string }
  /** `example` is the spec's own sample answer, when it has a small one: a fake answers with it. */
  response?: { confidence: Confidence; schema?: string; sensitive?: boolean; example?: unknown }
  security?: readonly SecurityRequirement[]
  permissions?: readonly OperationPermission[]
  pagination?: Pagination
}

const withoutUndefined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T

/** A lossless parser's number → a plain one, or its text when a double would round it. */
const plain = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(plain)
  if (value === null || typeof value !== "object") return value
  const lossless = value as { isLosslessNumber?: unknown; value?: unknown }
  if (lossless.isLosslessNumber === true && typeof lossless.value === "string") {
    const number = Number(lossless.value)
    return String(number) === lossless.value ? number : lossless.value
  }
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]))
}

const toManifest = (operation: ApiOperation, tree: SchemaTree): ManifestOperation =>
  withoutUndefined({
    id: operation.id,
    command: operation.command ?? kebab(operation.id),
    binding: operation.binding,
    effect: operation.effect as Effect,
    summary: operation.summary,
    description: operation.description,
    tags: operation.tags,
    deprecated: operation.deprecated,
    security: operation.security,
    permissions: operation.permissions,
    pagination: operation.pagination,
    parameters: operation.parameters.map((parameter) => withoutUndefined({ ...parameter })),
    request: operation.requestBody
      ? withoutUndefined({
          required: operation.requestBody.required,
          confidence: operation.requestBody.confidence,
          schema: tree.requestName(operation.id),
          contentType: operation.requestBody.contentType,
        })
      : undefined,
    response: operation.response
      ? withoutUndefined({
          confidence: operation.response.confidence,
          schema: tree.responseName(operation.id),
          sensitive: operation.response.schema?.sensitive,
          // A credential's sample is still a credential's shape; it stays out of the shipped manifest.
          example: operation.response.schema?.sensitive ? undefined : plain(operation.response.example),
        })
      : undefined,
  })

export const manifestGenerator =
  (options: { path: string; coreImport?: string }): CodeGenerator =>
  (model: ApiModel) => {
    const tree = new SchemaTree(model)
    const operations = model.operations.map((operation) => toManifest(operation, tree))
    // Only what the source has, so a manifest from a source without servers or schemes does not change.
    const extras = (
      [
        ["servers", "ApiServer", "readonly ApiServer[]", model.servers],
        ["securitySchemes", "SecurityScheme", "Readonly<Record<string, SecurityScheme>>", model.securitySchemes],
        ["security", "SecurityRequirement", "readonly SecurityRequirement[]", model.security],
      ] as const
    ).filter(([, , , value]) => value !== undefined)
    const types = ["ManifestOperation", ...extras.map(([, type]) => type)].sort()
    const content = [
      `import type { ${types.join(", ")} } from "${options.coreImport ?? "@wirecat/cli-base/codegen"}"`,
      "",
      `export const operations: readonly ManifestOperation[] = ${JSON.stringify(operations, null, 2)}`,
      ...extras.flatMap(([name, , type, value]) => [
        "",
        `export const ${name}: ${type} = ${JSON.stringify(value, null, 2)}`,
      ]),
      "",
    ].join("\n")
    return [{ path: options.path, content }]
  }

export const definitionsGenerator =
  (options: { path: string; coreImport?: string }): CodeGenerator =>
  (model: ApiModel) => {
    const tree = new SchemaTree(model)
    const definitions = Object.fromEntries(tree.named.map(({ name, schema }) => [name, schema.schema]))
    return [
      {
        path: options.path,
        content: `import type { SchemaNode } from "${options.coreImport ?? "@wirecat/cli-base/codegen"}"\n\nexport const definitions: Readonly<Record<string, SchemaNode>> = ${JSON.stringify(definitions, null, 2)}\n`,
      },
    ]
  }

const cell = (text: string | undefined): string => (text ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim()

export interface CoverageOptions {
  path: string
  title: string
  /** How a user reaches the operation, e.g. `max bot api get-my-info`. */
  command: (operation: ManifestOperation) => string
}

/** Every operation the source has, and how it is reached — the page a reviewer diffs after a sync. */
export const coverageGenerator =
  (options: CoverageOptions): CodeGenerator =>
  (model: ApiModel) => {
    const tree = new SchemaTree(model)
    const rows = model.operations.map((operation) => {
      const entry = toManifest(operation, tree)
      const binding =
        entry.binding.kind === "http" ? `${entry.binding.method} ${entry.binding.path}` : entry.binding.name
      const status = entry.deprecated ? "deprecated" : "generated"
      return `| \`${entry.id}\` | \`${binding}\` | \`${options.command(entry)}\` | ${entry.effect} | ${
        entry.request?.confidence ?? "—"
      } | ${status} | ${cell(entry.summary)} |`
    })
    const version = model.source.version ? ` ${model.source.version}` : ""
    const reasoned = model.operations.filter((operation) => operation.effectReason)
    const paged = model.operations.filter((operation) => operation.pagination)
    const guarded = model.operations.flatMap((operation) =>
      (operation.permissions ?? []).map((permission) => ({ id: operation.id, permission })),
    )
    const when = ({ body, query }: OperationPermission) =>
      [...(body ?? []).map((flag) => `body \`${flag}\``), ...(query ?? []).map((flag) => `query \`${flag}\``)].join(
        " or ",
      )
    const content = [
      `# ${options.title}`,
      "",
      `${model.operations.length} operations from ${model.source.kind}${version}.`,
      "",
      "| Operation | Call | Command | Effect | Request source | Status | Summary |",
      "|---|---|---|---|---|---|---|",
      ...rows,
      ...(reasoned.length > 0
        ? [
            "",
            "## Effects not taken from the HTTP method",
            "",
            "| Operation | Effect | Why |",
            "|---|---|---|",
            ...reasoned.map((one) => `| \`${one.id}\` | ${one.effect} | ${cell(one.effectReason)} |`),
          ]
        : []),
      ...(paged.length > 0
        ? [
            "",
            "## Pagination",
            "",
            "| Operation | Style | Request | Answer | Source |",
            "|---|---|---|---|---|",
            ...paged.map(({ id, pagination, paginationSource }) => {
              const page = pagination as Pagination
              const request = [
                "cursor" in page ? page.cursor : undefined,
                "offset" in page ? page.offset : undefined,
                "page" in page ? page.page : undefined,
                "limit" in page ? page.limit : undefined,
              ].flatMap((one) => (one ? [`${one.in} \`${one.name}\``] : []))
              const answer = [
                "next" in page ? `next \`${page.next}\`` : undefined,
                page.items ? `items \`${page.items}\`` : undefined,
                "hasMore" in page && page.hasMore ? `more \`${page.hasMore}\`` : undefined,
                "total" in page && page.total ? `total \`${page.total}\`` : undefined,
              ].filter(Boolean)
              return `| \`${id}\` | ${page.style} | ${request.join(", ") || "—"} | ${answer.join(", ")} | ${cell(paginationSource)} |`
            }),
          ]
        : []),
      ...(model.securityReason ? ["", "## Sign-in", "", `Not from the source: ${cell(model.securityReason)}`] : []),
      ...(guarded.length > 0
        ? [
            "",
            "## Permission keys",
            "",
            "| Operation | Key | When |",
            "|---|---|---|",
            ...guarded.map(({ id, permission }) => {
              const flags = when(permission)
              return `| \`${id}\` | \`${permission.key}\` | ${flags ? `${flags} is true` : "always"} |`
            }),
          ]
        : []),
      "",
    ].join("\n")
    return [{ path: options.path, content }]
  }
