import { HostApiError } from "./http.ts"

/** A comment on a PR that later runs replace, found by a hidden marker in its body. */
export interface MarkedComment {
  /** Text unique to this tool's comments, usually an HTML comment. */
  readonly marker: string
  /** The full comment; must contain the marker so the next run can find it. */
  readonly body: string
}

export interface ExistingComment {
  readonly id: number
  readonly body: string | null
}

/** The host-specific calls behind updating a comment in place. */
export interface CommentApi {
  listPage(page: number): Promise<readonly ExistingComment[]>
  create(body: string): Promise<void>
  update(id: number, body: string): Promise<void>
}

export const COMMENTS_PER_PAGE = 100
// A PR with over a thousand comments gets a new summary rather than an endless search.
const MAX_COMMENT_PAGES = 10

export async function upsertMarkedComment(api: CommentApi, comment: MarkedComment): Promise<void> {
  const existing = await findMarked(api, comment.marker)
  if (existing === undefined) {
    await api.create(comment.body)
    return
  }
  try {
    await api.update(existing.id, comment.body)
  } catch (error: unknown) {
    // Anyone can paste the marker into their own comment, which this token cannot edit.
    if (!(error instanceof HostApiError) || !error.isPermissionProblem) throw error
    await api.create(comment.body)
  }
}

async function findMarked(api: CommentApi, marker: string): Promise<ExistingComment | undefined> {
  for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
    const comments = await api.listPage(page)
    const found = comments.find((comment) => comment.body?.includes(marker))
    if (found !== undefined) return found
    if (comments.length < COMMENTS_PER_PAGE) return undefined
  }
  return undefined
}
