import { useState } from "react"
import type { ReactElement } from "react"
import { changedUnitsOf, FileChangeStatus, RiskSeverity, SyntaxAnalysisStatus } from "@lens/review-model"
import type { ChangedFile, PullRequest, Risk, SyntaxAnalysis, UnitRef } from "@lens/review-model"
import { worstSeverity } from "../risks.ts"
import { summarizeFile } from "../unitChange.ts"
import { FileMap, MIN_UNITS_FOR_MAP } from "./FileMap.tsx"
import { HunkView } from "./HunkView.tsx"
import { RiskList } from "./RiskView.tsx"
import { UnitCard } from "./UnitCard.tsx"

const ViewMode = { Units: "units", Lines: "lines" } as const
type ViewMode = (typeof ViewMode)[keyof typeof ViewMode]

interface FileViewProps {
  readonly file: ChangedFile
  /** Risk findings located in this file. */
  readonly findings: readonly Risk[]
  readonly pullRequest: PullRequest
  readonly onShowImpact: (unit: UnitRef) => void
}

export function FileView({ file, findings, pullRequest, onShowImpact }: FileViewProps): ReactElement {
  const units = changedUnitsOf(file)
  const [mode, setMode] = useState<ViewMode>(units.length > 0 ? ViewMode.Units : ViewMode.Lines)
  const { diff } = file

  return (
    <section className="file-view">
      <header className="file-view-header">
        <h2>
          {diff.status === FileChangeStatus.Renamed || diff.status === FileChangeStatus.Copied ? (
            <>
              <span className="previous-path">{diff.previousPath}</span> → {diff.path}{" "}
              <span className="similarity">{diff.similarity}% similar</span>
            </>
          ) : (
            diff.path
          )}
        </h2>
        {units.length > 0 && (
          <div className="view-toggle" role="group" aria-label="View">
            <button type="button" aria-pressed={mode === ViewMode.Units} onClick={() => setMode(ViewMode.Units)}>
              Changed units
            </button>
            <button type="button" aria-pressed={mode === ViewMode.Lines} onClick={() => setMode(ViewMode.Lines)}>
              Line diff
            </button>
          </div>
        )}
      </header>
      {file.noise !== null && (
        <p className="notice">
          Skippable: {file.noise.kind} file ({file.noise.reason}).
        </p>
      )}
      {findings.length > 0 && (
        <details className="file-risks" open={worstSeverity(findings) === RiskSeverity.High}>
          <summary>
            {findings.length} risk {findings.length === 1 ? "finding" : "findings"} in this file
          </summary>
          <RiskList findings={findings} pullRequest={pullRequest} onOpenFile={undefined} />
        </details>
      )}
      <AnalysisNote syntax={file.syntax} />
      {mode === ViewMode.Units && units.length > 0 ? (
        <>
          <UnitSummary file={file} />
          {file.syntax.status === SyntaxAnalysisStatus.Analyzed && units.length >= MIN_UNITS_FOR_MAP && (
            <FileMap units={units} outline={file.syntax.outline} calls={file.syntax.calls} />
          )}
          {units.map((unit, index) => (
            // Overloads and cfg variants can repeat a name and change, so the index disambiguates.
            <UnitCard key={`${index}:${unit.qualifiedName}`} unit={unit} index={index} onShowImpact={() => onShowImpact({ path: diff.path, qualifiedName: unit.qualifiedName })} />
          ))}
        </>
      ) : (
        <HunkView diff={diff} />
      )}
    </section>
  )
}

function UnitSummary({ file }: { readonly file: ChangedFile }): ReactElement {
  const { needsAttention, quiet } = summarizeFile(file)
  return (
    <p className="unit-summary">
      {needsAttention} {needsAttention === 1 ? "change needs" : "changes need"} review
      {quiet > 0 && `, ${quiet} collapsed (formatting, comments, renames or moves)`}.
    </p>
  )
}

function AnalysisNote({ syntax }: { readonly syntax: SyntaxAnalysis }): ReactElement | null {
  switch (syntax.status) {
    case SyntaxAnalysisStatus.Analyzed:
      return syntax.units.length === 0 ? <p className="notice">No code changes: only whitespace between definitions moved.</p> : null
    case SyntaxAnalysisStatus.Skipped:
      return <p className="notice">Not analyzed: {syntax.reason}. Showing the line diff.</p>
    case SyntaxAnalysisStatus.UnsupportedLanguage:
      return null
  }
}
