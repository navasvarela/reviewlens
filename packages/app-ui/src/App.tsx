import { useCallback, useEffect, useState } from "react"
import type { FormEvent, ReactElement } from "react"
import { ReviewStatus, RiskSeverity } from "@walkdiff/review-model"
import type { ReviewSummary } from "@walkdiff/review-model"
import { addReview, listReviews, refreshReview, removeReview } from "./api.ts"

const DOCS_URL = "https://github.com/navasvarela/walkdiff/blob/main/docs/README.md"
const TROUBLESHOOTING_URL = "https://github.com/navasvarela/walkdiff/blob/main/docs/troubleshooting.md"

// Often enough that an analysis finishing feels immediate; only while one is running.
const POLL_INTERVAL_MS = 1500

const STATUS_LABELS: Readonly<Record<ReviewStatus, string>> = {
  [ReviewStatus.Queued]: "Queued",
  [ReviewStatus.Analyzing]: "Analyzing…",
  [ReviewStatus.Ready]: "Ready",
  [ReviewStatus.Failed]: "Failed",
}

const LEVEL_LABELS: Readonly<Record<RiskSeverity, string>> = {
  [RiskSeverity.High]: "High",
  [RiskSeverity.Medium]: "Medium",
  [RiskSeverity.Low]: "Low",
}

export function App(): ReactElement {
  const [reviews, setReviews] = useState<readonly ReviewSummary[]>()
  const [problem, setProblem] = useState<string>()

  const reload = useCallback(async (): Promise<void> => {
    try {
      setReviews(await listReviews())
      setProblem(undefined)
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const busy = reviews?.some((review) => review.status === ReviewStatus.Queued || review.status === ReviewStatus.Analyzing) ?? false
  useEffect(() => {
    if (!busy) return undefined
    const timer = window.setInterval(() => void reload(), POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [busy, reload])

  const act = (action: () => Promise<void>): void => {
    void action()
      .then(reload)
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
  }

  return (
    <main className="page">
      <h1>Reviews</h1>
      <AddReviewForm onAdded={reload} />
      {problem !== undefined && <p className="problem">{problem}</p>}
      {reviews === undefined ? null : reviews.length === 0 ? (
        <p className="empty">Nothing here yet. Paste a pull request or merge request link above to start a review.</p>
      ) : (
        <ul className="reviews">
          {reviews.map((review) => (
            <ReviewRow
              key={review.id}
              review={review}
              onRefresh={() => act(() => refreshReview(review.id))}
              onRemove={() => act(() => removeReview(review.id))}
            />
          ))}
        </ul>
      )}
      <footer className="page-footer">
        <a href={DOCS_URL} target="_blank" rel="noreferrer">
          Documentation
        </a>
        <a href={TROUBLESHOOTING_URL} target="_blank" rel="noreferrer">
          Troubleshooting
        </a>
      </footer>
    </main>
  )
}

interface AddReviewFormProps {
  readonly onAdded: () => Promise<void>
}

function AddReviewForm({ onAdded }: AddReviewFormProps): ReactElement {
  const [url, setUrl] = useState("")
  const [ai, setAi] = useState(false)
  const [problem, setProblem] = useState<string>()

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    addReview({ url, ai })
      .then(() => {
        setUrl("")
        setProblem(undefined)
        return onAdded()
      })
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
  }

  return (
    <form className="add-review" onSubmit={submit}>
      <div className="add-row">
        <input
          type="url"
          value={url}
          required
          autoFocus
          placeholder="https://github.com/owner/repo/pull/123"
          aria-label="Pull request or merge request link"
          onChange={(event) => setUrl(event.target.value)}
        />
        <button type="submit">Add review</button>
      </div>
      <label className="add-option">
        <input type="checkbox" checked={ai} onChange={(event) => setAi(event.target.checked)} />
        Include AI review (sends the changed code to Anthropic; uses your credentials and costs money)
      </label>
      {problem !== undefined && <p className="problem">{problem}</p>}
    </form>
  )
}

interface ReviewRowProps {
  readonly review: ReviewSummary
  readonly onRefresh: () => void
  readonly onRemove: () => void
}

function ReviewRow({ review, onRefresh, onRemove }: ReviewRowProps): ReactElement {
  const working = review.status === ReviewStatus.Queued || review.status === ReviewStatus.Analyzing
  return (
    <li className="review">
      <div className="review-main">
        {review.securityLevel !== null && <span className={`level level-${review.securityLevel}`}>{LEVEL_LABELS[review.securityLevel]}</span>}
        {review.hasReport ? (
          <a className="review-title" href={`/reviews/${review.id}/`}>
            {review.title ?? review.displayName}
          </a>
        ) : (
          <span className="review-title">{review.title ?? review.displayName}</span>
        )}
        {review.status !== ReviewStatus.Ready && <span className={`status status-${review.status}`}>{STATUS_LABELS[review.status]}</span>}
      </div>
      <p className="review-meta">
        <a href={review.url} target="_blank" rel="noreferrer">
          {review.displayName}
        </a>
        {review.author !== null && <> by {review.author}</>}
        {review.unitsToReview !== null && <> · {review.unitsToReview} to review</>}
        {review.untouchedReferences !== null && review.untouchedReferences > 0 && <> · {review.untouchedReferences} untouched callers</>}
        {review.findings !== null && (
          <>
            {" "}
            · {review.findings} {review.findings === 1 ? "finding" : "findings"}
          </>
        )}
        {review.ai && <> · AI</>}
        <> · updated {new Date(review.updatedAt).toLocaleString()}</>
      </p>
      {review.error !== null && (
        <p className="problem">
          {review.error}{" "}
          <a href={TROUBLESHOOTING_URL} target="_blank" rel="noreferrer">
            How to fix this
          </a>
        </p>
      )}
      <div className="review-actions">
        <button type="button" disabled={working} onClick={onRefresh}>
          Refresh
        </button>
        <button type="button" onClick={onRemove}>
          Remove
        </button>
      </div>
    </li>
  )
}
