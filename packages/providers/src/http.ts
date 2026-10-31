import type { z } from "zod"

const UNAUTHORIZED_STATUSES: ReadonlySet<number> = new Set([401, 403, 404])
const MAX_ERROR_BODY_CHARS = 500
const MAX_REDIRECTS = 5
const FIRST_REDIRECT_STATUS = 300
const LAST_REDIRECT_STATUS = 399

export class HostApiError extends Error {
  override readonly name = "HostApiError"
  readonly status: number
  readonly url: string

  constructor(status: number, url: string, detail: string) {
    super(`${url} responded ${status}: ${detail}`)
    this.status = status
    this.url = url
  }

  /** True when the host refused the token, such as the read-only token of a fork's PR. */
  get isPermissionProblem(): boolean {
    return UNAUTHORIZED_STATUSES.has(this.status)
  }
}

export interface JsonRequest<T> {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly schema: z.ZodType<T>
  /** Shown when the host refuses the request; private repositories answer 404 without a token. */
  readonly authHint: string
}

export type WriteMethod = "POST" | "PATCH" | "PUT"

export interface JsonWrite<T> extends JsonRequest<T> {
  readonly method: WriteMethod
  readonly body: unknown
}

export function getJson<T>(request: JsonRequest<T>): Promise<T> {
  return send(request, { headers: request.headers })
}

export function writeJson<T>(request: JsonWrite<T>): Promise<T> {
  return send(request, {
    method: request.method,
    headers: { ...request.headers, "Content-Type": "application/json" },
    body: JSON.stringify(request.body),
  })
}

async function send<T>(request: JsonRequest<T>, init: RequestInit): Promise<T> {
  const response = await fetchWithinOrigin(request.url, init)
  if (!response.ok) {
    const body = (await response.text()).slice(0, MAX_ERROR_BODY_CHARS)
    const detail = UNAUTHORIZED_STATUSES.has(response.status) ? `${body}\n${request.authHint}` : body
    throw new HostApiError(response.status, request.url, detail)
  }
  const body: unknown = await response.json()
  return request.schema.parse(body)
}

/**
 * Follows redirects only on the same origin. `fetch` drops `Authorization` when it leaves an
 * origin but keeps custom headers, so GitLab's `PRIVATE-TOKEN` would go wherever a redirect
 * pointed. Renamed repositories redirect within their host, so those still work.
 */
async function fetchWithinOrigin(url: string, init: RequestInit): Promise<Response> {
  let current = new URL(url)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, { ...init, redirect: "manual" })
    const location = response.headers.get("location")
    if (response.status < FIRST_REDIRECT_STATUS || response.status > LAST_REDIRECT_STATUS || location === null) return response
    const target = new URL(location, current)
    if (target.origin !== current.origin) throw new HostApiError(response.status, url, `refused a redirect to another host (${target.origin}), which could expose the token`)
    current = target
  }
  throw new HostApiError(LAST_REDIRECT_STATUS, url, "too many redirects")
}
