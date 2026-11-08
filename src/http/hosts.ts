const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"

/** A lower-case hostname, or `*.` and at least two labels: `api.acme.example`, `*.cdn.acme.example`, never `*.com`. */
export const HOST_PATTERN = new RegExp(`^(?:${LABEL}(?:\\.${LABEL})*|\\*\\.${LABEL}(?:\\.${LABEL})+)$`)

export const hostProblems = (hosts: readonly string[]): string[] => [
  ...hosts
    .filter((host) => !HOST_PATTERN.test(host) || host.length > 253)
    .map(
      (host) =>
        `${JSON.stringify(host)} is not a host: a lower-case hostname with no scheme, port or path, or one leading *. before two labels or more`,
    ),
  ...hosts.filter((host, at) => hosts.indexOf(host) !== at).map((host) => `${JSON.stringify(host)} is listed twice`),
]

/** `*.x` covers every name under `x`, but not `x` itself. */
export const hostCovered = (hostname: string, hosts: readonly string[]): boolean => {
  const name = hostname.toLowerCase().replace(/\.$/, "")
  return hosts.some((host) => (host.startsWith("*.") ? name.endsWith(host.slice(1)) : name === host))
}
