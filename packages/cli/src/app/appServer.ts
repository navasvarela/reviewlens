import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { IncomingMessage, Server, ServerResponse } from "node:http"
import { join, resolve } from "node:path"
import { InvalidPullRequestUrlError } from "@lens/providers"
import { addReviewRequestSchema } from "@lens/review-model"
import { REPORT_PAGE_FILE } from "../report.ts"
import { addressOf, BASE_POLICY, listen, LOOPBACK_HOST, REPORT_PAGE_POLICY, respond, SECURITY_HEADERS } from "../server.ts"
import type { ReviewService } from "./reviewService.ts"
import type { ReviewStore } from "./reviewStore.ts"

export const API_KEY_HEADER = "x-lens-key"
const API_KEY_META = "lens-api-key"
const HOME_META = "lens-home"
const HOME_PATH = "/"
const MAX_REQUEST_BODY_BYTES = 64 * 1024
const API_KEY_BYTES = 32

// The UI's build sits at a fixed place in the workspace, as the CLI runs from source.
const APP_UI_DIST = resolve(import.meta.dirname, "../../../app-ui/dist")

// Pages show text and code from PRs, and the API behind them can act with the user's token.
const APP_PAGE_POLICY = `${BASE_POLICY}; script-src 'self'; style-src 'self'`

export interface AppServer {
  readonly url: string
  close(): Promise<void>
}

interface AppContext {
  readonly store: ReviewStore
  readonly service: ReviewService
  readonly apiKey: string
  readonly allowedHosts: ReadonlySet<string>
}

export class AppPortInUseError extends Error {
  override readonly name = "AppPortInUseError"

  constructor(port: number) {
    super(`Port ${port} is in use. If the app is already running, open http://${LOOPBACK_HOST}:${port}/, or pick another with --port.`)
  }
}

/** Serves the review list, the reports and their API, on the loopback interface only. */
export async function startAppServer(store: ReviewStore, service: ReviewService, port: number, apiKey: string = newApiKey()): Promise<AppServer> {
  const allowedHosts = new Set<string>()
  const context: AppContext = { store, service, apiKey, allowedHosts }
  const server = createServer((request, response) => {
    handle(request, response, context).catch((error: unknown) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })
  await listenOn(server, port)
  const bound = addressOf(server).port
  allowedHosts.add(`${LOOPBACK_HOST}:${bound}`)
  allowedHosts.add(`localhost:${bound}`)
  return {
    url: `http://${LOOPBACK_HOST}:${bound}/`,
    close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
  }
}

// Created fresh each run and never stored, so it lasts only as long as the process.
function newApiKey(): string {
  return randomBytes(API_KEY_BYTES).toString("hex")
}

async function listenOn(server: Server, port: number): Promise<void> {
  try {
    await listen(server, port)
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") throw new AppPortInUseError(port)
    throw error
  }
}

async function handle(request: IncomingMessage, response: ServerResponse, context: AppContext): Promise<void> {
  // A web page can point its own domain at 127.0.0.1 to read this server as if same-origin.
  // Refusing unknown Host headers closes that, for pages (which carry the key) and the API.
  if (!context.allowedHosts.has(request.headers.host ?? "")) {
    sendText(response, 403, "Forbidden")
    return
  }
  const { pathname } = new URL(request.url ?? "/", "http://localhost")
  if (pathname.startsWith("/api/")) {
    await handleApi(request, response, pathname, context)
    return
  }
  const reportId = /^\/reviews\/(\d+)\/?$/.exec(pathname)?.[1]
  if (reportId !== undefined) {
    await sendReportPage(response, Number(reportId), context)
    return
  }
  await sendAppFile(response, pathname, context)
}

async function handleApi(request: IncomingMessage, response: ServerResponse, pathname: string, context: AppContext): Promise<void> {
  // A custom header cannot be sent cross-origin without a preflight, which this server never
  // approves, so a key mismatch also stops other sites from triggering actions.
  if (request.headers[API_KEY_HEADER] !== context.apiKey) {
    sendJson(response, 401, { error: "The app was restarted. Reload this page." })
    return
  }
  const method = request.method ?? "GET"
  if (pathname === "/api/reviews") {
    if (method === "GET") {
      sendJson(response, 200, context.store.list())
      return
    }
    if (method === "POST") {
      await addReview(request, response, context)
      return
    }
  }
  const match = /^\/api\/reviews\/(\d+)(\/refresh)?$/.exec(pathname)
  const id = Number(match?.[1])
  if (match !== null && method === "POST" && match[2] !== undefined) {
    const review = context.service.refresh(id)
    sendJson(response, review === undefined ? 404 : 202, review ?? { error: "No such review" })
    return
  }
  if (match !== null && method === "DELETE" && match[2] === undefined) {
    context.store.remove(id)
    sendJson(response, 200, {})
    return
  }
  sendJson(response, 404, { error: "Not found" })
}

async function addReview(request: IncomingMessage, response: ServerResponse, context: AppContext): Promise<void> {
  const body = await readJsonBody(request)
  const parsed = addReviewRequestSchema.safeParse(body)
  if (!parsed.success) {
    sendJson(response, 400, { error: "Expected a pull request URL" })
    return
  }
  try {
    sendJson(response, 202, context.service.add(parsed.data))
  } catch (error: unknown) {
    if (!(error instanceof InvalidPullRequestUrlError)) throw error
    sendJson(response, 400, { error: error.message })
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return undefined
  }
}

async function sendReportPage(response: ServerResponse, id: number, context: AppContext): Promise<void> {
  const reportDir = context.store.reportDirOf(id)
  if (reportDir === undefined) {
    sendText(response, 404, "This review has no report yet.")
    return
  }
  const page = await readFile(join(reportDir, REPORT_PAGE_FILE), "utf8")
  sendHtml(response, withMeta(page, context.apiKey), REPORT_PAGE_POLICY)
}

async function sendAppFile(response: ServerResponse, pathname: string, context: AppContext): Promise<void> {
  const file = await respond(APP_UI_DIST, pathname)
  if (pathname !== HOME_PATH) {
    response.writeHead(file.status, { "Content-Type": file.contentType, ...SECURITY_HEADERS })
    response.end(file.body)
    return
  }
  if (file.status !== 200) {
    sendText(response, 500, "The app UI has not been built. Run: pnpm build:ui")
    return
  }
  sendHtml(response, withMeta(file.body.toString(), context.apiKey), APP_PAGE_POLICY)
}

/**
 * Hands the page its API key and the way home. Added per response, never written to disk,
 * so a report file saved or uploaded elsewhere holds neither.
 */
export function withMeta(page: string, apiKey: string): string {
  const meta = `<meta name="${API_KEY_META}" content="${apiKey}"><meta name="${HOME_META}" content="${HOME_PATH}">`
  return page.replace("</head>", () => `${meta}</head>`)
}

function sendHtml(response: ServerResponse, html: string, policy: string): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": policy, ...SECURITY_HEADERS })
  response.end(html)
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS })
  response.end(JSON.stringify(body))
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS })
  response.end(body)
}
