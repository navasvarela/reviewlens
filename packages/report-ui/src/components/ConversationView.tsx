import { useState } from "react"
import type { ReactElement } from "react"
import { ReviewerState } from "@walkdiff/review-model"
import type { ReviewThread } from "@walkdiff/review-model"
import { isWebLink, replyToThread, setThreadResolved } from "../appApi.ts"
import { useConversation, useReloadConversation } from "../conversationState.tsx"
import type { ReviewStop } from "../reviewPlan.ts"

const STATE_LABELS: Readonly<Record<ReviewerState, string>> = {
  [ReviewerState.Approved]: "approved",
  [ReviewerState.ChangesRequested]: "requested changes",
  [ReviewerState.Commented]: "commented",
  [ReviewerState.Other]: "reviewing",
}

/** Who has weighed in, on the brief. Silent until there's something to say. */
export function ReviewerSummary(): ReactElement | null {
  const load = useConversation()
  if (load.status !== "loaded" || load.conversation.reviewers.length === 0) return null
  return (
    <ul className="reviewer-summary" aria-label="Reviews so far">
      {load.conversation.reviewers.map((reviewer) => (
        <li key={reviewer.name} className={`reviewer-badge reviewer-badge-${reviewer.state}`}>
          {reviewer.name} {STATE_LABELS[reviewer.state]}
        </li>
      ))}
    </ul>
  )
}

/** The discussion already on a change, beside its code. */
export function StopThreads({ stop }: { readonly stop: ReviewStop }): ReactElement | null {
  const load = useConversation()
  if (load.status !== "loaded") return null
  const threads = load.conversation.threads.filter((thread) => isThreadOnStop(thread, stop))
  if (threads.length === 0) return null
  return (
    <section className="guide-section">
      <h2 className="guide-heading">Discussion</h2>
      {threads.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} />
      ))}
    </section>
  )
}

export function isThreadOnStop(thread: ReviewThread, stop: ReviewStop): boolean {
  if (thread.path !== stop.file.diff.path) return false
  if (stop.unit === null) return true
  if (thread.line === null || !("after" in stop.unit.change)) return false
  return thread.line >= stop.unit.change.after.startLine && thread.line <= stop.unit.change.after.endLine
}

export function ConversationView(): ReactElement {
  const load = useConversation()
  switch (load.status) {
    case "unavailable":
      return <p className="notice">Open this review in the Walkdiff app to see and join the discussion.</p>
    case "loading":
      return <p className="notice">Reading the discussion…</p>
    case "failed":
      return <p className="guide-error">{load.message}</p>
    case "loaded": {
      const open = load.conversation.threads.filter((thread) => !thread.isResolved)
      const resolved = load.conversation.threads.filter((thread) => thread.isResolved)
      return (
        <section className="conversation">
          <ReviewerSummaryBlock />
          {load.conversation.threads.length === 0 && <p className="notice">No discussion on the code yet.</p>}
          {open.map((thread) => (
            <ThreadCard key={thread.id} thread={thread} />
          ))}
          {resolved.length > 0 && (
            <details>
              <summary>{resolved.length} resolved</summary>
              {resolved.map((thread) => (
                <ThreadCard key={thread.id} thread={thread} />
              ))}
            </details>
          )}
          {load.conversation.truncated && <p className="notice">There's more on the PR than Walkdiff read. See the PR for the rest.</p>}
        </section>
      )
    }
  }
}

function ReviewerSummaryBlock(): ReactElement {
  return (
    <div className="conversation-reviewers">
      <ReviewerSummary />
    </div>
  )
}

function ThreadCard({ thread }: { readonly thread: ReviewThread }): ReactElement {
  const reload = useReloadConversation()
  const [reply, setReply] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const act = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setProblem(undefined)
    try {
      await action()
      await reload()
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className={thread.isResolved ? "thread thread-resolved" : "thread"}>
      {thread.path !== null && (
        <p className="thread-place">
          {thread.path}
          {thread.line === null ? "" : `:${thread.line}`}
          {thread.isOutdated && " · on code that has since changed"}
        </p>
      )}
      {thread.comments.map((comment) => (
        <div key={`${comment.author}:${comment.createdAt}`} className="thread-comment">
          <span className="thread-author">
            {isWebLink(comment.url) ? (
              <a href={comment.url} target="_blank" rel="noreferrer">
                {comment.author}
              </a>
            ) : (
              comment.author
            )}
          </span>
          <p>{comment.body}</p>
        </div>
      ))}
      <div className="thread-actions">
        <textarea rows={2} value={reply} aria-label="Your reply" placeholder="Reply" onChange={(event) => setReply(event.target.value)} />
        <button
          type="button"
          disabled={busy || reply.trim() === ""}
          onClick={() =>
            void act(async () => {
              await replyToThread(thread.id, reply)
              setReply("")
            })
          }
        >
          Post reply
        </button>
        <button type="button" disabled={busy} onClick={() => void act(() => setThreadResolved(thread.id, !thread.isResolved))}>
          {thread.isResolved ? "Reopen" : "Resolve"}
        </button>
      </div>
      {problem !== undefined && <p className="guide-error">{problem}</p>}
    </article>
  )
}
