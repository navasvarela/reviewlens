import { conversationSchema, submitResultSchema } from "@walkdiff/review-model"
import type { Conversation, SubmitResult, SubmitReview } from "@walkdiff/review-model"

const API_KEY_HEADER = "X-Walkdiff-Key"
const API_KEY_META = "walkdiff-api-key"
const REVIEW_ID_META = "walkdiff-review-id"

function meta(name: string): string | null {
  return document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? null
}

/** Only the local app adds these, so a report opened from a file or CI artifact stays read-only. */
export function isConnectedToApp(): boolean {
  return meta(API_KEY_META) !== null && meta(REVIEW_ID_META) !== null
}

async function call(path: string, method: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`/api/reviews/${meta(REVIEW_ID_META) ?? ""}${path}`, {
    method,
    headers: { [API_KEY_HEADER]: meta(API_KEY_META) ?? "", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload: unknown = await response.json()
  if (!response.ok) {
    throw new Error(typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : `The app answered ${response.status}`)
  }
  return payload
}

export async function loadConversation(): Promise<Conversation> {
  return conversationSchema.parse(await call("/conversation", "GET"))
}

export async function postReview(review: SubmitReview): Promise<SubmitResult> {
  return submitResultSchema.parse(await call("/submit", "POST", review))
}

export async function replyToThread(threadId: string, body: string): Promise<void> {
  await call(`/threads/${encodeURIComponent(threadId)}/reply`, "POST", { body })
}

export async function setThreadResolved(threadId: string, resolved: boolean): Promise<void> {
  await call(`/threads/${encodeURIComponent(threadId)}/resolve`, "POST", { resolved })
}

/** Links come from the host's answer, so only web addresses become clickable. */
export function isWebLink(url: string | null): url is string {
  return url !== null && /^https?:\/\//i.test(url)
}
