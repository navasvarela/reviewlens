import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { extname, join, normalize, sep } from "node:path"

const LOOPBACK_HOST = "127.0.0.1"
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

/** Serves a report directory on the loopback interface only, so it is never reachable from the network. */
export async function serveReport(reportDir: string, port: number): Promise<ReportServer> {
  const root = normalize(reportDir)
  const server = createServer((request, response) => {
    void respond(root, request.url ?? "/").then(({ status, contentType, body }) => {
      response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" })
      response.end(body)
    })
  })
  await listen(server, port)
  const { port: boundPort } = addressOf(server)
  return {
    url: `http://${LOOPBACK_HOST}:${boundPort}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

interface StaticResponse {
  readonly status: number
  readonly contentType: string
  readonly body: Buffer | string
}

async function respond(root: string, requestUrl: string): Promise<StaticResponse> {
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

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, LOOPBACK_HOST, () => {
      server.off("error", reject)
      resolve()
    })
  })
}

function addressOf(server: Server): AddressInfo {
  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new Error("The report server is not listening on a TCP port")
  }
  return address
}
