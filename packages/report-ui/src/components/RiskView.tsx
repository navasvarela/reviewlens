import type { ReactElement } from "react"
import type { PullRequest, Risk, RiskAssessment } from "@walkdiff/review-model"
import { CheckOutcome, summarizeChecks } from "../checkSummary.ts"
import type { CheckRow } from "../checkSummary.ts"
import { CATEGORY_LABELS, groupByRule, SEVERITY_LABELS } from "../risks.ts"
import { sourceLineUrl } from "../sourceLinks.ts"

const LEVEL_EXPLANATION =
  "The highest severity among security findings: secrets, risky APIs, code scans, sensitive areas, dependencies and known vulnerabilities. Low means the checks below found no security problems, not that the change is safe. Code quality findings do not affect it."

interface RiskViewProps {
  readonly risk: RiskAssessment
  readonly pullRequest: PullRequest
  readonly onOpenFile: (path: string) => void
}

/** The security level, what each check found or why it did not run, and every finding by rule. */
export function RiskView({ risk, pullRequest, onOpenFile }: RiskViewProps): ReactElement {
  return (
    <section className="risk-view">
      <div className={`level-box level-${risk.securityLevel}`}>
        <p className="level-title">
          Security level: <strong>{SEVERITY_LABELS[risk.securityLevel]}</strong>
        </p>
        <p className="level-explanation">{LEVEL_EXPLANATION}</p>
      </div>

      <h2 className="section-title">Checks</h2>
      <CheckTable risk={risk} />

      <h2 className="section-title">Risk findings ({risk.findings.length})</h2>
      {risk.findings.length === 0 ? (
        <p className="notice">No findings from the checks that ran.</p>
      ) : (
        <RiskList findings={risk.findings} pullRequest={pullRequest} onOpenFile={onOpenFile} />
      )}

    </section>
  )
}

function CheckTable({ risk }: { readonly risk: RiskAssessment }): ReactElement {
  return (
    <table className="check-table">
      <thead>
        <tr>
          <th scope="col">Check</th>
          <th scope="col">Result</th>
          <th scope="col">Details</th>
        </tr>
      </thead>
      <tbody>
        {summarizeChecks(risk).map((row) => (
          <tr key={row.name} className={`check-${row.outcome}`}>
            <th scope="row">{row.name}</th>
            <td className="check-result">{resultLabel(row)}</td>
            <td>{row.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function resultLabel(row: CheckRow): string {
  switch (row.outcome) {
    case CheckOutcome.Clean:
      return "✓ No issues"
    case CheckOutcome.Issues:
      return `${row.issues} ${row.issues === 1 ? "issue" : "issues"}`
    case CheckOutcome.NotRun:
      return "⚠ Didn't run"
  }
}

interface RiskListProps {
  readonly findings: readonly Risk[]
  readonly pullRequest: PullRequest
  readonly onOpenFile: ((path: string) => void) | undefined
}

export function RiskList({ findings, pullRequest, onOpenFile }: RiskListProps): ReactElement {
  return (
    <ul className="risk-list">
      {groupByRule(findings).map((group) => {
        const first = group.findings.at(0)
        if (first === undefined) return null
        return (
          <li key={`${group.ruleId}:${group.title}`} className={`risk risk-${first.severity}`}>
            <div className="risk-header">
              <span className={`severity severity-${first.severity}`}>{SEVERITY_LABELS[first.severity]}</span>
              <span className="risk-category">{CATEGORY_LABELS[first.category]}</span>
              <span className="risk-title">{group.title}</span>
              {group.findings.length > 1 && <span className="risk-count">×{group.findings.length}</span>}
            </div>
            <p className="risk-detail">{first.detail}</p>
            <ul className="risk-places">
              {group.findings.map((finding, index) => (
                <RiskPlace key={index} finding={finding} pullRequest={pullRequest} onOpenFile={onOpenFile} />
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

interface RiskPlaceProps {
  readonly finding: Risk
  readonly pullRequest: PullRequest
  readonly onOpenFile: ((path: string) => void) | undefined
}

function RiskPlace({ finding, pullRequest, onOpenFile }: RiskPlaceProps): ReactElement | null {
  const { location } = finding
  if (location === null) return null
  const label = location.line === null ? location.path : `${location.path}:${location.line}`
  return (
    <li className="risk-place">
      {onOpenFile === undefined ? (
        <code>{label}</code>
      ) : (
        <button type="button" className="link-button" onClick={() => onOpenFile(location.path)}>
          {label}
        </button>
      )}
      {location.line !== null && (
        <a href={sourceLineUrl(pullRequest, location.path, location.line)} target="_blank" rel="noreferrer" title="Open on the host">
          ↗
        </a>
      )}
      {finding.evidence !== null && <code className="risk-evidence">{finding.evidence}</code>}
    </li>
  )
}
