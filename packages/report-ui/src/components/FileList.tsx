import type { ReactElement } from "react"
import { FileChangeStatus } from "@lens/review-model"
import type { ChangedFile, Risk } from "@lens/review-model"
import { findingsInFile, SEVERITY_LABELS, worstSeverity } from "../risks.ts"
import { summarizeFile, unitsOf } from "../unitChange.ts"

interface StatusBadge {
  readonly letter: string
  readonly label: string
}

const STATUS_BADGES: Readonly<Record<FileChangeStatus, StatusBadge>> = {
  [FileChangeStatus.Added]: { letter: "A", label: "Added" },
  [FileChangeStatus.Modified]: { letter: "M", label: "Modified" },
  [FileChangeStatus.Deleted]: { letter: "D", label: "Deleted" },
  [FileChangeStatus.Renamed]: { letter: "R", label: "Renamed" },
  [FileChangeStatus.Copied]: { letter: "C", label: "Copied" },
}

interface FileListProps {
  readonly files: readonly ChangedFile[]
  readonly findings: readonly Risk[]
  readonly selectedPath: string | undefined
  readonly overviewSelected: boolean
  readonly onSelect: (path: string) => void
  readonly onSelectOverview: () => void
}

/** The risk overview, then files needing review; lockfiles, generated and vendored files grouped below. */
export function FileList({ files, findings, selectedPath, overviewSelected, onSelect, onSelectOverview }: FileListProps): ReactElement {
  const reviewable = files.filter((file) => file.noise === null)
  const skippable = files.filter((file) => file.noise !== null)
  return (
    <nav className="file-list" aria-label="Changed files">
      <button
        type="button"
        className={overviewSelected ? "file overview selected" : "file overview"}
        aria-current={overviewSelected}
        onClick={onSelectOverview}
      >
        <span className="path">Risks &amp; checks</span>
        <span className="counts">{findings.length}</span>
      </button>
      <FileGroup files={reviewable} findings={findings} selectedPath={selectedPath} onSelect={onSelect} />
      {skippable.length > 0 && (
        <>
          <h3 className="file-group-title">Skippable ({skippable.length})</h3>
          <FileGroup files={skippable} findings={findings} selectedPath={selectedPath} onSelect={onSelect} />
        </>
      )}
    </nav>
  )
}

interface FileGroupProps {
  readonly files: readonly ChangedFile[]
  readonly findings: readonly Risk[]
  readonly selectedPath: string | undefined
  readonly onSelect: (path: string) => void
}

function FileGroup({ files, findings, selectedPath, onSelect }: FileGroupProps): ReactElement {
  return (
    <ul>
      {files.map((file) => {
        const { diff } = file
        const badge = STATUS_BADGES[diff.status]
        const selected = diff.path === selectedPath
        return (
          <li key={diff.path}>
            <button
              type="button"
              className={selected ? "file selected" : "file"}
              aria-current={selected}
              title={file.noise?.reason}
              onClick={() => onSelect(diff.path)}
            >
              <span className={`status status-${diff.status}`} title={badge.label}>
                {badge.letter}
              </span>
              <span className="path">
                {diff.path}
                <FileHint file={file} />
              </span>
              <RiskBadge findings={findingsInFile(findings, diff.path)} />
              <span className="counts">
                <span className="added">+{diff.additions}</span> <span className="removed">−{diff.deletions}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function FileHint({ file }: { readonly file: ChangedFile }): ReactElement | null {
  if (file.noise !== null) {
    return <span className="file-hint">{file.noise.kind}</span>
  }
  if (unitsOf(file).length === 0) {
    return null
  }
  const { needsAttention, quiet, untouchedReferences } = summarizeFile(file)
  if (needsAttention === 0) {
    return <span className="file-hint">no behaviour change</span>
  }
  return (
    <span className="file-hint">
      {needsAttention} to review{quiet > 0 ? ` · ${quiet} collapsed` : ""}
      {untouchedReferences > 0 && <span className="file-hint-impact"> · {untouchedReferences} untouched callers</span>}
    </span>
  )
}

function RiskBadge({ findings }: { readonly findings: readonly Risk[] }): ReactElement | null {
  const severity = worstSeverity(findings)
  if (severity === undefined) return null
  return (
    <span className={`severity severity-${severity}`} title={`${findings.length} risk findings, worst: ${SEVERITY_LABELS[severity]}`}>
      {findings.length}
    </span>
  )
}
