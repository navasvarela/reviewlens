import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { extname, join, normalize, sep } from "node:path"

export const LOOPBACK_HOST = "127.0.0.1"
const INDEX_FILE = "index.html"
const FALLBACK_CONTENT_TYPE = "application/octet-stream"
const PLAIN_TEXT = "text/plain; charset=utf-8"
const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
])

export interface ReportServer {
  readonly url: string
  close(): Promise<void>
}

/**
 * What every page from a local server gets. A report shows text from PRs, so even if a crafted
 * PR got script onto a page, the policy leaves it nothing to reach.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
}
export const BASE_POLICY = "default-src 'none'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
// A report is one self-contained file, so its script and styles are inline.
export const REPORT_PAGE_POLICY = `${BASE_POLICY}; script-src 'unsafe-inline'; style-src 'unsafe-inline'`

/** The Host values a loopback server answers to. */
export function loopbackHosts(port: number): ReadonlySet<string> {
  return new Set([`${LOOPBACK_HOST}:${port}`, `localhost:${port}`])
}

/**
 * Serves a report directory on the loopback interface only, so it is never reachable from
 * the network. Listening locally is not enough: a website can point its own domain at
 * 127.0.0.1 (DNS rebinding) and then read this server as same-origin, so any other Host is
 * refused.
 */
export async function serveReport(reportDir: string, port: number): Promise<ReportServer> {
  const root = normalize(reportDir)
  let allowedHosts: ReadonlySet<string> = new Set()
  const server = createServer((request, response) => {
    if (!allowedHosts.has(request.headers.host ?? "")) {
      response.writeHead(403, { "Content-Type": PLAIN_TEXT, ...SECURITY_HEADERS })
      response.end("Forbidden")
      return
    }
    void respond(root, request.url ?? "/").then(({ status, contentType, body }) => {
      response.writeHead(status, { "Content-Type": contentType, "Content-Security-Policy": REPORT_PAGE_POLICY, ...SECURITY_HEADERS })
      response.end(body)
    })
  })
  await listen(server, port)
  const { port: boundPort } = addressOf(server)
  allowedHosts = loopbackHosts(boundPort)
  return {
    url: `http://${LOOPBACK_HOST}:${boundPort}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

export interface StaticResponse {
  readonly status: number
  readonly contentType: string
  readonly body: Buffer | string
}

export async function respond(root: string, requestUrl: string): Promise<StaticResponse> {
  const filePath = resolveInsideRoot(root, requestUrl)
  if (filePath === undefined) {
    return { status: 403, contentType: PLAIN_TEXT, body: "Forbidden" }
  }
  try {
    const body = await readFile(filePath)
    return { status: 200, contentType: CONTENT_TYPES.get(extname(filePath)) ?? FALLBACK_CONTENT_TYPE, body }
  } catch {
    return { status: 404, contentType: PLAIN_TEXT, body: "Not found" }
  }
}

// Rejects any request whose decoded path escapes the report directory (e.g. `/../`)
// or cannot be decoded at all.
function resolveInsideRoot(root: string, requestUrl: string): string | undefined {
  const pathname = decodePathname(requestUrl)
  if (pathname === undefined) {
    return undefined
  }
  const relative = pathname.endsWith("/") ? `${pathname}${INDEX_FILE}` : pathname
  const filePath = normalize(join(root, relative))
  return filePath.startsWith(root + sep) ? filePath : undefined
}

function decodePathname(requestUrl: string): string | undefined {
  try {
    return decodeURIComponent(new URL(requestUrl, "http://localhost").pathname)
  } catch (error: unknown) {
    if (error instanceof URIError) {
      return undefined
    }
    throw error
  }
}

export function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, LOOPBACK_HOST, () => {
      server.off("error", reject)
      resolve()
    })
  })
}

export function addressOf(server: Server): AddressInfo {
  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new Error("The report server is not listening on a TCP port")
  }
  return address
}
