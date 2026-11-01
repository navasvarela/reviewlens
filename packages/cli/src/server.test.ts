import { get } from "node:http"
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { assembleReportPage } from "./report.ts"
import { serveReport } from "./server.ts"
import type { ReportServer } from "./server.ts"
import { protectLocalData } from "./environment.ts"

interface Reply {
  readonly status: number | undefined
  readonly policy: string | string[] | undefined
  readonly sniff: string | string[] | undefined
}

function request(url: string, host: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    get(url, { headers: { host } }, (response) => {
      response.resume()
      resolve({ status: response.statusCode, policy: response.headers["content-security-policy"], sniff: response.headers["x-content-type-options"] })
    }).on("error", reject)
  })
}

describe("serveReport", () => {
  let dir = ""
  let server: ReportServer | undefined

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "walkdiff-server-test-"))
    await writeFile(join(dir, "index.html"), "<html></html>")
    server = await serveReport(dir, 0)
  })
  afterAll(async () => {
    await server?.close()
    await rm(dir, { recursive: true, force: true })
  })

  it("refuses another host name, so a rebound domain cannot read the report", async () => {
    expect((await request(server?.url ?? "", "evil.example")).status).toBe(403)
    expect((await request(server?.url ?? "", "evil.example:80")).status).toBe(403)
  })

  it("answers on its own address, with a policy that blocks outside contact", async () => {
    const url = new URL(server?.url ?? "")
    const reply = await request(url.href, url.host)
    expect(reply.status).toBe(200)
    expect(reply.policy).toContain("default-src 'none'")
    expect(reply.sniff).toBe("nosniff")
  })
})

describe("the report file", () => {
  const page = '<html><head><script type="module" crossorigin src="./a.js"></script><link rel="stylesheet" crossorigin href="./a.css"></head></html>'
  const assembled = assembleReportPage(page, new Map([["a.js", "1"], ["a.css", "b{}"]]), "{}")

  it("carries a policy that forbids any network contact", () => {
    expect(assembled).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'`)
    expect(assembled).not.toContain("connect-src")
  })

  it("places the policy before the embedded PR text", () => {
    expect(assembled.indexOf("Content-Security-Policy")).toBeLessThan(assembled.indexOf('id="review-model"'))
  })
})

describe("protectLocalData", () => {
  it("closes the default folders to other users and ignores missing ones", async () => {
    const home = await mkdtemp(join(tmpdir(), "walkdiff-perm-test-"))
    await mkdir(join(home, "cache", "walkdiff"), { recursive: true, mode: 0o755 })
    await protectLocalData({ XDG_CACHE_HOME: join(home, "cache"), XDG_DATA_HOME: join(home, "data") })
    expect((await stat(join(home, "cache", "walkdiff"))).mode & 0o777).toBe(0o700)
    await rm(home, { recursive: true, force: true })
  })
})
