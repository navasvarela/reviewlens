import { reviewModelSchema } from "@walkdiff/review-model"
import type { ReviewModel } from "@walkdiff/review-model"

// Only the Vite dev server uses this; built reports embed the model in the page.
const REVIEW_MODEL_URL = "./review.json"
const EMBEDDED_MODEL_ELEMENT_ID = "review-model"

export type ReviewLoad =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly review: ReviewModel }
  | { readonly status: "failed"; readonly message: string }

export async function loadReview(): Promise<ReviewLoad> {
  try {
    const result = reviewModelSchema.safeParse(await readModelJson())
    if (!result.success) {
      return { status: "failed", message: `The review data does not match this report version: ${result.error.message}` }
    }
    return { status: "loaded", review: result.data }
  } catch (error: unknown) {
    return { status: "failed", message: error instanceof Error ? error.message : String(error) }
  }
}

async function readModelJson(): Promise<unknown> {
  const embedded = document.getElementById(EMBEDDED_MODEL_ELEMENT_ID)?.textContent
  if (embedded !== undefined && embedded !== null) {
    return JSON.parse(embedded)
  }
  const response = await fetch(REVIEW_MODEL_URL)
  if (!response.ok) {
    throw new Error(`Could not load ${REVIEW_MODEL_URL} (HTTP ${response.status}).`)
  }
  return response.json()
}
