import { reviewSummarySchema } from "@lens/review-model"
import type { AddReviewRequest, ReviewSummary } from "@lens/review-model"

const API_KEY_HEADER = "X-Lens-Key"

function apiKey(): string {
  return document.querySelector('meta[name="lens-api-key"]')?.getAttribute("content") ?? ""
}

async function call(path: string, method: string, body?: AddReviewRequest): Promise<unknown> {
  const response = await fetch(path, {
    method,
    headers: { [API_KEY_HEADER]: apiKey(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload: unknown = await response.json()
  if (!response.ok) {
    throw new Error(errorMessage(payload) ?? `The app answered ${response.status}`)
  }
  return payload
}

function errorMessage(payload: unknown): string | undefined {
  return typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : undefined
}

export async function listReviews(): Promise<readonly ReviewSummary[]> {
  return reviewSummarySchema.array().parse(await call("/api/reviews", "GET"))
}

export async function addReview(request: AddReviewRequest): Promise<void> {
  await call("/api/reviews", "POST", request)
}

export async function refreshReview(id: number): Promise<void> {
  await call(`/api/reviews/${id}/refresh`, "POST")
}

export async function removeReview(id: number): Promise<void> {
  await call(`/api/reviews/${id}`, "DELETE")
}
