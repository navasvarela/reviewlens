import type { ReactElement } from "react"
import { FileChangeStatus } from "@lens/review-model"
import type { ChangedFile } from "@lens/review-model"
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
  readonly selectedPath: string | undefined
  readonly onSelect: (path: string) => void
}

/** Files needing review first; lockfiles, generated and vendored files grouped below. */
export function FileList({ files, selectedPath, onSelect }: FileListProps): ReactElement {
  const reviewable = files.filter((file) => file.noise === null)
  const skippable = files.filter((file) => file.noise !== null)
  return (
    <nav className="file-list" aria-label="Changed files">
      <FileGroup files={reviewable} selectedPath={selectedPath} onSelect={onSelect} />
      {skippable.length > 0 && (
        <>
          <h3 className="file-group-title">Skippable ({skippable.length})</h3>
          <FileGroup files={skippable} selectedPath={selectedPath} onSelect={onSelect} />
        </>
      )}
    </nav>
  )
}

function FileGroup({ files, selectedPath, onSelect }: FileListProps): ReactElement {
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
