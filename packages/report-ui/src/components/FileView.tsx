import { useState } from "react"
import type { ReactElement } from "react"
import { FileChangeStatus, SyntaxAnalysisStatus } from "@lens/review-model"
import type { ChangedFile, PullRequest, SyntaxAnalysis } from "@lens/review-model"
import { summarizeFile, unitsOf } from "../unitChange.ts"
import { HunkView } from "./HunkView.tsx"
import { UnitCard } from "./UnitCard.tsx"

const ViewMode = { Units: "units", Lines: "lines" } as const
type ViewMode = (typeof ViewMode)[keyof typeof ViewMode]

interface FileViewProps {
  readonly file: ChangedFile
  readonly pullRequest: PullRequest
}

export function FileView({ file, pullRequest }: FileViewProps): ReactElement {
  const units = unitsOf(file)
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
      <AnalysisNote syntax={file.syntax} />
      {mode === ViewMode.Units && units.length > 0 ? (
        <>
          <UnitSummary file={file} />
          {units.map((unit, index) => (
            // Overloads and cfg variants can repeat a name and change, so the index disambiguates.
            <UnitCard key={`${index}:${unit.qualifiedName}`} unit={unit} pullRequest={pullRequest} />
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
