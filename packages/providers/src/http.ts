import type { z } from "zod"

const UNAUTHORIZED_STATUSES: ReadonlySet<number> = new Set([401, 403, 404])
const MAX_ERROR_BODY_CHARS = 500

export class HostApiError extends Error {
  override readonly name = "HostApiError"
  readonly status: number
  readonly url: string

  constructor(status: number, url: string, detail: string) {
    super(`${url} responded ${status}: ${detail}`)
    this.status = status
    this.url = url
  }
}

export interface JsonRequest<T> {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly schema: z.ZodType<T>
  /** Shown when the host refuses the request; private repositories answer 404 without a token. */
  readonly authHint: string
}

export async function getJson<T>(request: JsonRequest<T>): Promise<T> {
  const response = await fetch(request.url, { headers: request.headers })
  if (!response.ok) {
    const body = (await response.text()).slice(0, MAX_ERROR_BODY_CHARS)
    const detail = UNAUTHORIZED_STATUSES.has(response.status) ? `${body}\n${request.authHint}` : body
    throw new HostApiError(response.status, request.url, detail)
  }
  const body: unknown = await response.json()
  return request.schema.parse(body)
}
