/**
 * Swagger 1.2 and 2.0 → OpenAPI 3, so `adaptOpenApi` reads one format. Build-time only: the two converters are
 * optional peer dependencies, loaded on first use, and a CLI that converts installs them as dev dependencies.
 */
import { isObject, OpenApiError } from "./openapi.js"

type Json = Record<string, unknown>

const load = async <T>(name: string, use: string): Promise<T> => {
  try {
    return (await import(name)) as T
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string }
    if (code !== "ERR_MODULE_NOT_FOUND" || !message?.includes(`'${name}'`)) throw error
    throw new OpenApiError([`${use} needs ${name}: add it to the CLI's devDependencies`])
  }
}

/**
 * An OpenAPI 3 document, from an OpenAPI 3 document (returned as it is), a Swagger 2.0 one, or a Swagger 1.2 resource
 * listing with its API declarations keyed by the listing's `apis[].path` (each served at `basePath` + that path).
 */
export const upgradeToOpenApi3 = async (
  document: unknown,
  declarations?: Readonly<Record<string, unknown>>,
): Promise<Json> => {
  if (!isObject(document)) throw new OpenApiError(["not an OpenAPI or Swagger document"])
  if (typeof document.openapi === "string" && document.openapi.startsWith("3.")) return document
  let swagger2 = document
  if (typeof document.swaggerVersion === "string" && document.swaggerVersion.startsWith("1.")) {
    if (!declarations) throw new OpenApiError(["a Swagger 1.x resource listing needs its API declarations"])
    const converter = await load<{ default: { convert: (listing: Json, apis: object) => Json } }>(
      "swagger-converter",
      "Swagger 1.x",
    )
    swagger2 = converter.default.convert(document, declarations)
  } else if (document.swagger !== "2.0") {
    throw new OpenApiError(["not an OpenAPI 3, Swagger 2.0 or Swagger 1.x document"])
  }
  const { upgrade } = await load<{ upgrade: (value: Json, version: "3.0") => Json }>(
    "@scalar/openapi-upgrader",
    "Swagger",
  )
  // The upgrader changes the document it is given, which is the caller's own for Swagger 2.0.
  return upgrade(structuredClone(swagger2), "3.0")
}
