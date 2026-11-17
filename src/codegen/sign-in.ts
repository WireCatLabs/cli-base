/**
 * Which sign-in one call of a generated manifest needs and where its token goes. cli-core's `api` group signs requests
 * by this and `fakeApi` checks them by it, so a CLI's test and its real calls cannot disagree.
 */
import type { SecurityRequirement, SecurityScheme } from "./model.js"

/** Where one scheme carries a token, and what the header or query parameter then holds. */
export interface SignInPlace {
  in: "header" | "query"
  /** A header name in lower case, or a query parameter as the spec spells it. */
  name: string
  value: (token: string) => string
}

const BEARER: SignInPlace = { in: "header", name: "authorization", value: (token) => `Bearer ${token}` }

/** `undefined` for a scheme a token cannot be sent by: basic, digest, a key in a cookie, mutual TLS. */
export const signInPlace = (scheme: SecurityScheme): SignInPlace | undefined => {
  if (scheme.type === "apiKey") {
    if (!scheme.name || (scheme.in !== "header" && scheme.in !== "query")) return undefined
    return {
      in: scheme.in,
      name: scheme.in === "header" ? scheme.name.toLowerCase() : scheme.name,
      value: (token) => token,
    }
  }
  if (scheme.type === "http") {
    if (!scheme.scheme || /^bearer$/i.test(scheme.scheme)) return BEARER
    if (/^(basic|digest)$/i.test(scheme.scheme)) return undefined
    return { in: "header", name: "authorization", value: (token) => `${scheme.scheme} ${token}` }
  }
  return scheme.type === "oauth2" || scheme.type === "openIdConnect" ? BEARER : undefined
}

/**
 * The requirements one call signs in by: the operation's own `security`, else the document's. `undefined` when it needs
 * no sign-in: neither says anything, as in a spec without security, or every requirement is `{}` (`security: []`
 * included). An optional sign-in (`[{}, { oauth: [] }]`) still signs in.
 */
export const signInRequirements = (
  operation: { security?: readonly SecurityRequirement[] },
  document: readonly SecurityRequirement[] | undefined,
): readonly SecurityRequirement[] | undefined => {
  const requirements = operation.security ?? document
  return requirements?.some((one) => Object.keys(one).length > 0) ? requirements : undefined
}
