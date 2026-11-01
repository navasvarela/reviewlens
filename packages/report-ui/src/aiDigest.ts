import { AiReviewStatus, CitationSide, IntentVerdict } from "@walkdiff/review-model"
import type { AiReview, Citation, IntentFinding, ReviewerQuestion } from "@walkdiff/review-model"
import type { ReviewStop } from "./reviewPlan.ts"

export interface AiDigest {
  /** Where the code and the description disagree: the part a reviewer must act on. */
  readonly mismatches: readonly IntentFinding[]
  readonly matches: readonly IntentFinding[]
  readonly questions: readonly ReviewerQuestion[]
}

export interface AiStopNote {
  readonly title: string
  readonly detail: string
}

export function digestAiReview(ai: AiReview): AiDigest | undefined {
  if (ai.status !== AiReviewStatus.Completed) return undefined
  return {
    mismatches: ai.intent.filter((finding) => finding.verdict !== IntentVerdict.Matches),
    matches: ai.intent.filter((finding) => finding.verdict === IntentVerdict.Matches),
    questions: ai.questions,
  }
}

/** The AI's points about this change, so they're read beside the code they concern. */
export function aiNotesForStop(ai: AiReview, stop: ReviewStop): AiStopNote[] {
  const digest = digestAiReview(ai)
  if (digest === undefined) return []
  const isHere = (citations: readonly Citation[]): boolean => citations.some((citation) => citesStop(citation, stop))
  return [
    ...digest.mismatches.filter((finding) => isHere(finding.citations)).map((finding) => ({ title: finding.claim, detail: finding.explanation })),
    ...digest.questions.filter((question) => isHere(question.citations)).map((question) => ({ title: question.question, detail: question.why })),
  ]
}

function citesStop(citation: Citation, stop: ReviewStop): boolean {
  if (citation.path !== stop.file.diff.path) return false
  if (stop.unit === null) return true
  const { change } = stop.unit
  const snapshot = citation.side === CitationSide.Before ? ("before" in change ? change.before : undefined) : "after" in change ? change.after : undefined
  return snapshot !== undefined && citation.startLine <= snapshot.endLine && citation.endLine >= snapshot.startLine
}
