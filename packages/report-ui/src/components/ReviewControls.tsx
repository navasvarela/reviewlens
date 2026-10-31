import { useId, useState } from "react"
import type { ReactElement } from "react"
import { isReviewed } from "../reviewProgress.ts"
import { useReviewState } from "../reviewState.tsx"

interface ReviewControlsProps {
  /** Everything this control marks; a file marks all of its functions at once. */
  readonly ids: readonly string[]
  /** Where a comment is saved. Absent where marking covers several things. */
  readonly commentId?: string | undefined
  readonly markLabel?: string
}

/** The same marking and comments wherever a change appears, so there is one review record. */
export function ReviewControls({ ids, commentId, markLabel = "Mark as reviewed" }: ReviewControlsProps): ReactElement {
  const { state, setReviewed } = useReviewState()
  const reviewed = isReviewed(ids, state)
  return (
    <div className="review-controls">
      <button type="button" className={reviewed ? "review-mark review-mark-done" : "review-mark"} aria-pressed={reviewed} onClick={() => setReviewed(ids, !reviewed)}>
        {reviewed ? "✓ Reviewed" : markLabel}
      </button>
      {commentId !== undefined && <CommentBox id={commentId} />}
    </div>
  )
}

function CommentBox({ id }: { readonly id: string }): ReactElement {
  const { state, setComment } = useReviewState()
  const text = state.comments.get(id) ?? ""
  const [open, setOpen] = useState(false)
  const fieldId = useId()
  if (!open && text === "") {
    return (
      <button type="button" className="review-comment-add" onClick={() => setOpen(true)}>
        Add comment
      </button>
    )
  }
  return (
    <div className="review-comment">
      <label htmlFor={fieldId} className="review-comment-label">
        Your comment
      </label>
      <textarea id={fieldId} rows={3} value={text} autoFocus={open} placeholder="What should the author look at?" onChange={(event) => setComment(id, event.target.value)} />
      <p className="review-comment-note">Saved in this browser. Lens can't post to the PR yet, so copy your comments from the finish screen.</p>
    </div>
  )
}
