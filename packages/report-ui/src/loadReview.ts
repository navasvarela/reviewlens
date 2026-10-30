import { reviewModelSchema } from "@lens/review-model"
import type { ReviewModel } from "@lens/review-model"

// Relative, so the report works wherever its directory is served from.
const REVIEW_MODEL_URL = "./review.json"

export type ReviewLoad =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly review: ReviewModel }
  | { readonly status: "failed"; readonly message: string }

export async function loadReview(): Promise<ReviewLoad> {
  try {
    const response = await fetch(REVIEW_MODEL_URL)
    if (!response.ok) {
      return { status: "failed", message: `Could not load ${REVIEW_MODEL_URL} (HTTP ${response.status}).` }
    }
    const result = reviewModelSchema.safeParse(await response.json())
    if (!result.success) {
      return { status: "failed", message: `review.json does not match this report version: ${result.error.message}` }
    }
    return { status: "loaded", review: result.data }
  } catch (error: unknown) {
    return { status: "failed", message: error instanceof Error ? error.message : String(error) }
  }
}
