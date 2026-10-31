import { useEffect, useMemo, useState } from "react"
import type { ReactElement } from "react"
import { UnitImpactStatus } from "@lens/review-model"
import type { ChangedUnit, ReviewModel } from "@lens/review-model"
import { buildReviewPlan, changeSummary, FINISH_HASH, GuideRouteKind, hashForStop, REVIEW_HASH } from "../reviewPlan.ts"
import type { GuideRoute, LowerPriority, ReviewPlan, ReviewStop } from "../reviewPlan.ts"
import { factPhrases } from "../unitChange.ts"
import { HunkView } from "./HunkView.tsx"
import { ImpactPanel } from "./ImpactPanel.tsx"
import { RiskList } from "./RiskView.tsx"
import { UnitBody } from "./UnitCard.tsx"

const ALL_CHANGES_HASH = "#changes"
const NEXT_KEY = "j"
const PREVIOUS_KEY = "k"
const PROGRESS_KEY_PREFIX = "lens-progress:"

interface ReviewGuideProps {
  readonly review: ReviewModel
  readonly route: GuideRoute
}

/** The guided review: a brief, one stop at a time, and a clear end. */
export function ReviewGuide({ review, route }: ReviewGuideProps): ReactElement {
  const plan = useMemo(() => buildReviewPlan(review), [review])
  const [visited, markVisited] = useVisitedStops(review.pullRequest.headSha)
  const stopIndex = route.kind === GuideRouteKind.Stop ? route.index : undefined

  useEffect(() => {
    window.scrollTo(0, 0)
    if (stopIndex !== undefined) markVisited(stopIndex)
  }, [route, stopIndex, markVisited])
  useKeyboardNavigation(route, plan.stops.length)

  switch (route.kind) {
    case GuideRouteKind.Brief:
      return <Brief review={review} plan={plan} visited={visited} />
    case GuideRouteKind.Finish:
      return <Finish review={review} plan={plan} visited={visited} />
    case GuideRouteKind.Stop: {
      const stop = plan.stops.at(route.index)
      if (stop === undefined) return <Finish review={review} plan={plan} visited={visited} />
      return <StopView review={review} stop={stop} index={route.index} total={plan.stops.length} />
    }
  }
}

function Brief({ review, plan, visited }: { readonly review: ReviewModel; readonly plan: ReviewPlan; readonly visited: ReadonlySet<number> }): ReactElement {
  const { pullRequest, files } = review
  const additions = files.reduce((sum, file) => sum + file.diff.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.diff.deletions, 0)
  const firstUnvisited = plan.stops.findIndex((_, index) => !visited.has(index))
  const resumeAt = firstUnvisited === -1 ? 0 : firstUnvisited
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
          <strong>
            {plan.stops.length} {plan.stops.length === 1 ? "change needs" : "changes need"} your attention.
          </strong>{" "}
          {plan.lowerPriorityTotal > 0 && `${plan.lowerPriorityTotal} are lower priority.`}
          {plan.sizeNote !== null && <span className="guide-note"> {plan.sizeNote}. Consider splitting it.</span>}
        </p>
        {plan.stops.length > 0 && (
          <a className="guide-button guide-button-primary" href={hashForStop(resumeAt)}>
            {visited.size > 0 && visited.size < plan.stops.length ? "Continue review" : "Start review"}
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

function StopView({ review, stop, index, total }: { readonly review: ReviewModel; readonly stop: ReviewStop; readonly index: number; readonly total: number }): ReactElement {
  const nextHash = index + 1 < total ? hashForStop(index + 1) : FINISH_HASH
  const previousHash = index > 0 ? hashForStop(index - 1) : REVIEW_HASH
  const position = index + 1
  // A finding about the whole file is already explained under "Why it's here".
  const located = stop.findings.filter((finding) => finding.location?.line !== null)
  return (
    <main className="guide guide-wide">
      <div className="guide-progress-row">
        <a href={REVIEW_HASH}>Brief</a>
        <span>
          {position} of {total}
        </span>
      </div>
      <div className="guide-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={position} aria-label="Review progress">
        <div className="guide-progress-bar" style={{ width: `${Math.round((position / total) * 100)}%` }} />
      </div>

      <h1 className="guide-stop-title">
        <code>{stop.title}</code> <span className="guide-stop-kind">{changeSummary(stop)}</span>
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

      <nav className="guide-nav" aria-label="Review path">
        <a className="guide-button" href={previousHash}>
          Back
        </a>
        <a className="guide-all-changes" href={ALL_CHANGES_HASH}>
          All changes
        </a>
        <a className="guide-button guide-button-primary" href={nextHash}>
          {index + 1 < total ? "Next" : "Finish"}
        </a>
      </nav>
      <p className="guide-keys">
        Press <kbd>{NEXT_KEY}</kbd> for next and <kbd>{PREVIOUS_KEY}</kbd> for back.
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

function Finish({ review, plan, visited }: { readonly review: ReviewModel; readonly plan: ReviewPlan; readonly visited: ReadonlySet<number> }): ReactElement {
  const seen = plan.stops.filter((_, index) => visited.has(index)).length
  const allSeen = plan.stops.length > 0 && seen === plan.stops.length
  const skipped = describeLowerPriority(plan.lowerPriority)
  return (
    <main className="guide">
      <h1 className="guide-title">{allSeen ? "You've been through the path" : `You've seen ${seen} of ${plan.stops.length} changes on the path`}</h1>
      <p className="guide-lede">The decision is yours. Lens only points at what to look at.</p>

      {skipped.length > 0 && (
        <section className="guide-section">
          <h2 className="guide-heading">Not on the path</h2>
          <ul className="guide-plain-list">
            {skipped.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="guide-note">
            <a href={ALL_CHANGES_HASH}>See all changes</a>
          </p>
        </section>
      )}

      {review.risk.notChecked.length > 0 && (
        <section className="guide-section">
          <h2 className="guide-heading">What Lens couldn't check</h2>
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
        <a className="guide-button" href={plan.stops.length > 0 ? hashForStop(0) : REVIEW_HASH}>
          Go through it again
        </a>
        <a className="guide-button guide-button-primary" href={review.pullRequest.url} target="_blank" rel="noreferrer">
          Open the PR to respond
        </a>
      </div>
    </main>
  )
}

function describeLowerPriority(lower: LowerPriority): string[] {
  const line = (count: number, one: string, many: string): string[] => (count === 0 ? [] : [`${count} ${count === 1 ? one : many}`])
  return [
    ...line(lower.otherCode, "other code change", "other code changes"),
    ...line(lower.newCode, "new function or type", "new functions or types"),
    ...line(lower.testFiles, "test file", "test files"),
    ...line(lower.otherFiles, "other file, such as docs or config", "other files, such as docs or config"),
    ...line(lower.quiet, "change to formatting, comments or names only", "changes to formatting, comments or names only"),
  ]
}

function useKeyboardNavigation(route: GuideRoute, total: number): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (route.kind === GuideRouteKind.Stop) {
        if (event.key === NEXT_KEY) window.location.hash = route.index + 1 < total ? hashForStop(route.index + 1) : FINISH_HASH
        if (event.key === PREVIOUS_KEY) window.location.hash = route.index > 0 ? hashForStop(route.index - 1) : REVIEW_HASH
      } else if (route.kind === GuideRouteKind.Brief && event.key === NEXT_KEY && total > 0) {
        window.location.hash = hashForStop(0)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [route, total])
}

/**
 * Progress lives in this browser only, keyed by commit so a re-push starts afresh. Storage can
 * be unavailable, as in a private window or a file opened from disk, and then progress lasts
 * until the page closes. "Changes since my last review" will replace this.
 */
function useVisitedStops(headSha: string): [ReadonlySet<number>, (index: number) => void] {
  const key = `${PROGRESS_KEY_PREFIX}${headSha}`
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set(readProgress(key)))
  const [mark] = useState(() => (index: number): void => {
    setVisited((current) => {
      if (current.has(index)) return current
      const next = new Set(current).add(index)
      writeProgress(key, [...next])
      return next
    })
  })
  return [visited, mark]
}

function readProgress(key: string): number[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number") : []
  } catch {
    return []
  }
}

function writeProgress(key: string, stops: readonly number[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(stops))
  } catch {
    // Progress is a convenience: without storage it lasts until the page closes.
  }
}
