import type { ReactElement } from "react"
import { AiReviewStatus, CitationSide, IntentVerdict } from "@walkdiff/review-model"
import type { AiReview, Citation, PullRequest } from "@walkdiff/review-model"
import { sourceLineUrl } from "../sourceLinks.ts"

const VERDICT_LABELS: Readonly<Record<IntentVerdict, string>> = {
  [IntentVerdict.Matches]: "Matches",
  [IntentVerdict.Contradicts]: "Contradicts",
  [IntentVerdict.Undocumented]: "Not in description",
  [IntentVerdict.NotFound]: "Not found in code",
}

interface AiReviewViewProps {
  readonly ai: AiReview
  readonly pullRequest: PullRequest
  readonly onOpenFile: (path: string) => void
}

/** The model's reading order, intent check and questions; pointers for the reviewer, not verdicts. */
export function AiReviewView({ ai, pullRequest, onOpenFile }: AiReviewViewProps): ReactElement {
  switch (ai.status) {
    case AiReviewStatus.Disabled:
      return <p className="ai-note">AI review is off. Run with --ai to add a reading order, an intent check and reviewer questions.</p>
    case AiReviewStatus.Unavailable:
      return <p className="ai-note">AI review was requested but not produced: {ai.reason}.</p>
    case AiReviewStatus.Completed:
      return (
        <section className="ai-review">
          <p className="ai-note">
            Written by {ai.model}. Every item cites lines of this change
            {ai.droppedStatements > 0 && (
              <>
                ; {ai.droppedStatements} {ai.droppedStatements === 1 ? "statement without valid citations was" : "statements without valid citations were"}{" "}
                discarded
              </>
            )}
            {ai.unitsSummarizedOnly > 0 && (
              <>
                ; {ai.unitsSummarizedOnly} {ai.unitsSummarizedOnly === 1 ? "unit was" : "units were"} sent by name only, to stay within the input
                budget
              </>
            )}
            . Treat
            these as pointers, not verdicts.
          </p>

          <h2 className="section-title">Suggested reading order</h2>
          <ol className="chapters">
            {ai.chapters.map((chapter) => (
              <li key={chapter.title} className="chapter">
                <p className="chapter-title">{chapter.title}</p>
                <p className="chapter-summary">{chapter.summary}</p>
                <ul className="chapter-units">
                  {chapter.units.map((unit) => (
                    <li key={`${unit.path}:${unit.qualifiedName}`}>
                      <button type="button" className="link-button" onClick={() => onOpenFile(unit.path)}>
                        {unit.qualifiedName}
                      </button>{" "}
                      <span className="chapter-path">{unit.path}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          {ai.intent.length > 0 && (
            <>
              <h2 className="section-title">Description vs. code</h2>
              <ul className="ai-list">
                {ai.intent.map((finding, index) => (
                  <li key={index} className="ai-item">
                    <span className={`verdict verdict-${finding.verdict}`}>{VERDICT_LABELS[finding.verdict]}</span>
                    <span className="ai-item-title">{finding.claim}</span>
                    <p className="ai-item-detail">{finding.explanation}</p>
                    <Citations citations={finding.citations} pullRequest={pullRequest} onOpenFile={onOpenFile} />
                  </li>
                ))}
              </ul>
            </>
          )}

          {ai.questions.length > 0 && (
            <>
              <h2 className="section-title">Questions to answer before approving</h2>
              <ol className="ai-list questions">
                {ai.questions.map((question, index) => (
                  <li key={index} className="ai-item">
                    <span className="ai-item-title">{question.question}</span>
                    <p className="ai-item-detail">{question.why}</p>
                    <Citations citations={question.citations} pullRequest={pullRequest} onOpenFile={onOpenFile} />
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )
  }
}

interface CitationsProps {
  readonly citations: readonly Citation[]
  readonly pullRequest: PullRequest
  readonly onOpenFile: (path: string) => void
}

function Citations({ citations, pullRequest, onOpenFile }: CitationsProps): ReactElement | null {
  if (citations.length === 0) return null
  return (
    <ul className="citations">
      {citations.map((citation) => {
        const lines = citation.startLine === citation.endLine ? `${citation.startLine}` : `${citation.startLine}-${citation.endLine}`
        const label = `${citation.path}:${lines}${citation.side === CitationSide.Before ? " (before)" : ""}`
        return (
          <li key={`${citation.path}:${citation.side}:${citation.startLine}:${citation.endLine}`}>
            <button type="button" className="link-button" onClick={() => onOpenFile(citation.path)}>
              {label}
            </button>
            <a href={sourceLineUrl(pullRequest, citation.path, citation.startLine, citation.side)} target="_blank" rel="noreferrer" title="Open on the host">
              ↗
            </a>
          </li>
        )
      })}
    </ul>
  )
}
