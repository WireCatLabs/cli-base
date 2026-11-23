import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const CI_PAGE = join(dirname(fileURLToPath(import.meta.url)), "../../docs/standards/ci.md")

/**
 * WC-CI-9's table of the WireCat repositories' monthly minutes, as `HH:MM → repository`: from the given text of
 * `docs/standards/ci.md`, or from the copy this package ships.
 *
 * @experimental
 */
export const takenMinutes = (ciPage: string = readFileSync(CI_PAGE, "utf8")): Map<string, string> =>
  new Map(
    [...ciPage.matchAll(/^\s*\|\s*(\d\d:\d\d)\s*\|\s*([\w.-]+)\s*\|\s*$/gm)].map(([, time, repo]) => [
      time as string,
      repo as string,
    ]),
  )
