import { useEffect, useMemo, useState } from "react"
import type { ReactElement } from "react"
import { UnitImpactStatus } from "@walkdiff/review-model"
import type { ChangedUnit, ReviewModel } from "@walkdiff/review-model"
import { buildReviewPlan, changeSummary, FINISH_HASH, GuideRouteKind, hashForStop, REVIEW_HASH } from "../reviewPlan.ts"
import type { GuideRoute, ReviewPlan, ReviewStop } from "../reviewPlan.ts"
import { commentsAsMarkdown, commentsOnItems, isReviewed, ItemKind, nextUnreviewedStop, overallProgress, pathProgress, remainingOffPath, stopItemIds } from "../reviewProgress.ts"
import type { ItemComment, Progress, RemainingCounts, ReviewState } from "../reviewProgress.ts"
import { useReviewState } from "../reviewState.tsx"
import { factPhrases } from "../unitChange.ts"
import { HunkView } from "./HunkView.tsx"
import { ImpactPanel } from "./ImpactPanel.tsx"
import { ReviewControls } from "./ReviewControls.tsx"
import { RiskList } from "./RiskView.tsx"
import { UnitBody } from "./UnitCard.tsx"

const ALL_CHANGES_HASH = "#changes"
const NEXT_KEY = "j"
const PREVIOUS_KEY = "k"
const MARK_KEY = "r"
const PERCENT = 100
const COPY_CONFIRMATION_MS = 2_000
const CopyResult = { None: "none", Copied: "copied", Failed: "failed" } as const
type CopyResult = (typeof CopyResult)[keyof typeof CopyResult]

interface ReviewGuideProps {
  readonly review: ReviewModel
  readonly route: GuideRoute
}

/** The guided review: a brief, one change at a time beside the full path, and a clear end. */
export function ReviewGuide({ review, route }: ReviewGuideProps): ReactElement {
  const plan = useMemo(() => buildReviewPlan(review), [review])
  const { state, setReviewed } = useReviewState()
  const current = route.kind === GuideRouteKind.Stop ? plan.stops.at(route.index) : undefined

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [route])
  useKeyboardShortcuts(route, plan, current === undefined ? undefined : () => setReviewed(stopItemIds(current), !isReviewed(stopItemIds(current), state)))

  if (route.kind === GuideRouteKind.Brief) return <Brief review={review} plan={plan} state={state} />
  return (
    <div className="guide-with-rail">
      <ReviewRail review={review} plan={plan} state={state} currentIndex={route.kind === GuideRouteKind.Stop ? route.index : undefined} />
      {route.kind === GuideRouteKind.Stop && current !== undefined ? (
        <StopView review={review} stop={current} index={route.index} total={plan.stops.length} />
      ) : (
        <Finish review={review} plan={plan} state={state} />
      )}
    </div>
  )
}

function Brief({ review, plan, state }: { readonly review: ReviewModel; readonly plan: ReviewPlan; readonly state: ReviewState }): ReactElement {
  const { pullRequest, files } = review
  const additions = files.reduce((sum, file) => sum + file.diff.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.diff.deletions, 0)
  const path = pathProgress(plan, state)
  const resumeAt = nextUnreviewedStop(plan, state)
  return (
    <main className="guide">
      <p className="guide-eyebrow">
        <a href={pullRequest.url} target="_blank" rel="noreferrer">
          #{pullRequest.number}
        </a>{" "}
        by {pullRequest.author} · {files.length} {files.length === 1 ? "file" : "files"} · <span className="added">+{additions}</span> <span className="removed">−{deletions}</span>
      </p>
      <h1 className="guide-title">{pullRequest.title}</h1>

      {plan.checks.length === 0 ? (
        <p className="guide-all-clear">No warnings from the checks that ran. That doesn't mean the change is safe.</p>
      ) : (
        <section aria-labelledby="guide-checks">
          <h2 id="guide-checks" className="guide-heading">
            Check {plan.checks.length === 1 ? "this" : `these ${plan.checks.length} things`}
          </h2>
          <ul className="guide-checks">
            {plan.checks.map((check) => (
              <li key={check.message} className={`guide-check guide-check-${check.severity}`}>
                {check.stopIndex === undefined ? check.message : <a href={hashForStop(check.stopIndex)}>{check.message}</a>}
              </li>
            ))}
          </ul>
          {plan.moreChecks > 0 && (
            <p className="guide-note">
              <a href="#risks">{plan.moreChecks} more</a> in the full list.
            </p>
          )}
        </section>
      )}

      <div className="guide-start">
        <p className="guide-effort">
          {path.reviewed === 0 ? (
            <>
              <strong>
                {plan.stops.length} {plan.stops.length === 1 ? "change needs" : "changes need"} your attention.
              </strong>{" "}
              {plan.lowerPriorityTotal > 0 && `${plan.lowerPriorityTotal} are lower priority.`}
            </>
          ) : (
            <strong>
              You've reviewed {path.reviewed} of {path.total} on the path.
            </strong>
          )}
          {plan.sizeNote !== null && <span className="guide-note"> {plan.sizeNote}. Consider splitting it.</span>}
        </p>
        {plan.stops.length > 0 && (
          <a className="guide-button guide-button-primary" href={resumeAt === undefined ? FINISH_HASH : hashForStop(resumeAt)}>
            {resumeAt === undefined ? "See your review" : path.reviewed > 0 ? "Continue review" : "Start review"}
          </a>
        )}
      </div>

      <footer className="guide-footer">
        <a href={ALL_CHANGES_HASH}>All changes</a>
        {review.risk.notChecked.length > 0 && (
          <a href={FINISH_HASH}>
            {review.risk.notChecked.length} {review.risk.notChecked.length === 1 ? "check" : "checks"} didn't run
          </a>
        )}
      </footer>
    </main>
  )
}

function ProgressBar({ progress, label }: { readonly progress: Progress; readonly label: string }): ReactElement {
  const percent = progress.total === 0 ? 0 : Math.round((progress.reviewed / progress.total) * PERCENT)
  return (
    <div className="guide-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.reviewed} aria-label={label}>
      <div className="guide-progress-bar" style={{ width: `${percent}%` }} />
    </div>
  )
}

interface ReviewRailProps {
  readonly review: ReviewModel
  readonly plan: ReviewPlan
  readonly state: ReviewState
  readonly currentIndex: number | undefined
}

/** The whole path at a glance: what's done, where you are, and a link to every stop. */
function ReviewRail({ review, plan, state, currentIndex }: ReviewRailProps): ReactElement {
  const path = pathProgress(plan, state)
  const overall = overallProgress(review.files, state)
  const done = path.total > 0 && path.reviewed === path.total
  return (
    <nav className="guide-rail" aria-label="Review path">
      <a className="guide-rail-brief" href={REVIEW_HASH}>
        ← Brief
      </a>
      <p className="guide-rail-title">{done ? "✓ Path complete" : `${path.reviewed} of ${path.total} reviewed`}</p>
      <ProgressBar progress={path} label="Progress on the review path" />
      <ol className="guide-rail-list">
        {plan.stops.map((stop, index) => (
          <RailItem key={stopItemIds(stop).join()} stop={stop} index={index} state={state} current={index === currentIndex} />
        ))}
      </ol>
      <a className={currentIndex === undefined ? "guide-rail-finish guide-rail-finish-current" : "guide-rail-finish"} href={FINISH_HASH} aria-current={currentIndex === undefined ? "page" : undefined}>
        Finish
      </a>
      <div className="guide-rail-overall">
        <p>
          {overall.reviewed} of {overall.total} changes overall
        </p>
        <ProgressBar progress={overall} label="Progress across all changes" />
        <a href={ALL_CHANGES_HASH}>All changes</a>
      </div>
    </nav>
  )
}

function RailItem({ stop, index, state, current }: { readonly stop: ReviewStop; readonly index: number; readonly state: ReviewState; readonly current: boolean }): ReactElement {
  const ids = stopItemIds(stop)
  const reviewed = isReviewed(ids, state)
  const commented = ids.some((id) => state.comments.has(id))
  const classes = ["guide-rail-item", current ? "guide-rail-item-current" : "", reviewed ? "guide-rail-item-done" : ""].filter((name) => name !== "").join(" ")
  return (
    <li>
      <a className={classes} href={hashForStop(index)} aria-current={current ? "step" : undefined}>
        <span className="guide-rail-mark" aria-label={reviewed ? "Reviewed" : "Not reviewed"}>
          {reviewed ? "✓" : index + 1}
        </span>
        <span className="guide-rail-text">
          <span className="guide-rail-name">{stop.unit === null ? stop.file.diff.path.split("/").at(-1) : stop.title}</span>
          <span className="guide-rail-path">{stop.file.diff.path}</span>
        </span>
        {commented && <span className="guide-rail-comment" title="You left a comment here">Comment</span>}
      </a>
    </li>
  )
}

function StopView({ review, stop, index, total }: { readonly review: ReviewModel; readonly stop: ReviewStop; readonly index: number; readonly total: number }): ReactElement {
  const { state, setReviewed } = useReviewState()
  const ids = stopItemIds(stop)
  const reviewed = isReviewed(ids, state)
  const nextHash = index + 1 < total ? hashForStop(index + 1) : FINISH_HASH
  const previousHash = index > 0 ? hashForStop(index - 1) : REVIEW_HASH
  // A finding about the whole file is already explained under "Why it's here".
  const located = stop.findings.filter((finding) => finding.location?.line !== null)
  const markAndContinue = (): void => {
    setReviewed(ids, true)
    window.location.hash = nextHash
  }
  return (
    <main className="guide-stop">
      <h1 className="guide-stop-title">
        <span className="guide-stop-number">{index + 1}</span> <code>{stop.title}</code> <span className="guide-stop-kind">{changeSummary(stop)}</span>
      </h1>
      {stop.unit !== null && <p className="guide-path">{stop.file.diff.path}</p>}

      <div className="guide-why">
        <p className="guide-why-title">Why it's here</p>
        {stop.reasons.length === 0 ? (
          <p>It changes how existing code behaves, though nothing specific stands out.</p>
        ) : (
          <ul>
            {stop.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>

      {stop.unit !== null && stop.unit.facts !== null && (
        <ul className="guide-facts" aria-label="What changed">
          {factPhrases(stop.unit.facts).map((phrase) => (
            <li key={phrase}>{phrase}</li>
          ))}
        </ul>
      )}

      {stop.unit === null ? <HunkView diff={stop.file.diff} /> : <UnitBody unit={stop.unit} />}

      {located.length > 0 && (
        <section className="guide-section">
          <h2 className="guide-heading">Findings</h2>
          <RiskList findings={located} pullRequest={review.pullRequest} onOpenFile={undefined} />
        </section>
      )}
      {stop.unit !== null && <Callers unit={stop.unit} review={review} />}
      {stop.unit !== null && <TestsLine tests={stop.relatedTests} />}

      <div className="guide-section">
        <ReviewControls key={ids.join()} ids={ids} commentId={ids.at(0)} />
      </div>

      <nav className="guide-nav" aria-label="Move through the path">
        <a className="guide-button" href={previousHash}>
          Back
        </a>
        <div className="guide-nav-forward">
          {!reviewed && (
            <a className="guide-button" href={nextHash}>
              Skip for now
            </a>
          )}
          {reviewed ? (
            <a className="guide-button guide-button-primary" href={nextHash}>
              {index + 1 < total ? "Next" : "Finish"}
            </a>
          ) : (
            <button type="button" className="guide-button guide-button-primary" onClick={markAndContinue}>
              {index + 1 < total ? "Reviewed, next" : "Reviewed, finish"}
            </button>
          )}
        </div>
      </nav>
      <p className="guide-keys">
        <kbd>{NEXT_KEY}</kbd> next · <kbd>{PREVIOUS_KEY}</kbd> back · <kbd>{MARK_KEY}</kbd> mark as reviewed
      </p>
    </main>
  )
}

function Callers({ unit, review }: { readonly unit: ChangedUnit; readonly review: ReviewModel }): ReactElement | null {
  const impact = unit.impact
  if (impact === null) return null
  if (impact.status === UnitImpactStatus.Traced && impact.totalReferences === 0) return null
  const summary = impact.status === UnitImpactStatus.Traced ? `Used in ${impact.totalReferences} ${impact.totalReferences === 1 ? "place" : "places"}` : "Callers weren't traced"
  return (
    <details className="guide-section guide-details">
      <summary>{summary}</summary>
      <ImpactPanel unit={unit} impact={impact} pullRequest={review.pullRequest} />
    </details>
  )
}

function TestsLine({ tests }: { readonly tests: readonly string[] }): ReactElement {
  return tests.length === 0 ? (
    <p className="guide-tests">No changed test mentions this. That doesn't mean it's untested.</p>
  ) : (
    <p className="guide-tests">
      Changed tests that mention it:{" "}
      {tests.map((test, index) => (
        <span key={test}>
          {index > 0 && ", "}
          <code>{test}</code>
        </span>
      ))}
      . This is a hint, not proof that it's tested.
    </p>
  )
}

function Finish({ review, plan, state }: { readonly review: ReviewModel; readonly plan: ReviewPlan; readonly state: ReviewState }): ReactElement {
  const path = pathProgress(plan, state)
  const overall = overallProgress(review.files, state)
  const pathDone = path.total > 0 && path.reviewed === path.total
  const allDone = overall.total > 0 && overall.reviewed === overall.total
  const remaining = describeRemaining(remainingOffPath(review.files, plan, state))
  const comments = commentsOnItems(review.files, state)
  const resumeAt = nextUnreviewedStop(plan, state)
  return (
    <main className="guide-stop guide-finish">
      <h1 className="guide-title">{allDone ? "You've reviewed every change" : pathDone ? "You've finished the review path" : `${path.reviewed} of ${path.total} reviewed on the path`}</h1>
      <p className="guide-lede">
        {overall.reviewed} of {overall.total} changes reviewed overall. The decision is yours: Walkdiff only points at what to look at.
      </p>

      {comments.length > 0 && <Comments comments={comments} />}

      {remaining.length > 0 && (
        <section className="guide-section">
          <h2 className="guide-heading">Not reviewed, and not on the path</h2>
          <ul className="guide-plain-list">
            {remaining.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="guide-note">
            <a href={ALL_CHANGES_HASH}>Review these in All changes</a>
          </p>
        </section>
      )}

      {review.risk.notChecked.length > 0 && (
        <section className="guide-section">
          <h2 className="guide-heading">What Walkdiff couldn't check</h2>
          <ul className="guide-plain-list">
            {review.risk.notChecked.map((skippedCheck) => (
              <li key={skippedCheck.check}>
                {skippedCheck.check}: {skippedCheck.reason}.
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="guide-start">
        {resumeAt !== undefined && (
          <a className="guide-button" href={hashForStop(resumeAt)}>
            Continue the path
          </a>
        )}
        <a className="guide-button guide-button-primary" href={review.pullRequest.url} target="_blank" rel="noreferrer">
          Open the PR to respond
        </a>
      </div>
    </main>
  )
}

function Comments({ comments }: { readonly comments: readonly ItemComment[] }): ReactElement {
  const [copyResult, setCopyResult] = useState<CopyResult>(CopyResult.None)
  const markdown = commentsAsMarkdown(comments)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopyResult(CopyResult.Copied)
      setTimeout(() => setCopyResult(CopyResult.None), COPY_CONFIRMATION_MS)
    } catch {
      // Browsers can refuse clipboard access, as on a report opened from disk.
      setCopyResult(CopyResult.Failed)
    }
  }
  return (
    <section className="guide-section">
      <h2 className="guide-heading">
        Your {comments.length === 1 ? "comment" : `${comments.length} comments`}
      </h2>
      <ul className="guide-comment-list">
        {comments.map(({ item, text }) => (
          <li key={item.id}>
            <code>{item.label}</code>
            <p>{text}</p>
          </li>
        ))}
      </ul>
      <button type="button" className="guide-button" onClick={() => void copy()}>
        {copyResult === CopyResult.Copied ? "Copied" : "Copy comments for the PR"}
      </button>
      {copyResult === CopyResult.Failed && <p className="guide-note">Your browser blocked copying. Select the comments above and copy them instead.</p>}
    </section>
  )
}

function describeRemaining(counts: RemainingCounts): string[] {
  const line = (count: number, one: string, many: string): string[] => (count === 0 ? [] : [`${count} ${count === 1 ? one : many}`])
  return [
    ...line(counts[ItemKind.ChangedCode], "other code change", "other code changes"),
    ...line(counts[ItemKind.NewCode], "new function or type", "new functions or types"),
    ...line(counts[ItemKind.Test], "test change", "test changes"),
    ...line(counts[ItemKind.File], "other file, such as docs or config", "other files, such as docs or config"),
  ]
}

function useKeyboardShortcuts(route: GuideRoute, plan: ReviewPlan, toggleReviewed: (() => void) | undefined): void {
  const total = plan.stops.length
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      if (route.kind === GuideRouteKind.Stop) {
        if (event.key === NEXT_KEY) window.location.hash = route.index + 1 < total ? hashForStop(route.index + 1) : FINISH_HASH
        if (event.key === PREVIOUS_KEY) window.location.hash = route.index > 0 ? hashForStop(route.index - 1) : REVIEW_HASH
        if (event.key === MARK_KEY) toggleReviewed?.()
      } else if (route.kind === GuideRouteKind.Brief && event.key === NEXT_KEY && total > 0) {
        window.location.hash = hashForStop(0)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [route, total, toggleReviewed])
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)
}
