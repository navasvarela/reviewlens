import type { ReactElement } from "react"
import { DiffLineKind, FileContentKind } from "@walkdiff/review-model"
import type { DiffLine, FileDiff, Hunk } from "@walkdiff/review-model"

interface HunkViewProps {
  readonly diff: FileDiff
}

/** Git's own view of the change, for files without unit analysis and as a fallback. */
export function HunkView({ diff }: HunkViewProps): ReactElement {
  if (diff.content.kind === FileContentKind.Binary) {
    return <p className="notice">Binary file; no text diff.</p>
  }
  if (diff.content.hunks.length === 0) {
    return <p className="notice">No content changes (rename or file mode only).</p>
  }
  return (
    <table className="code hunks">
      <colgroup>
        <col className="line-number-column" />
        <col className="line-number-column" />
        <col />
      </colgroup>
      {diff.content.hunks.map((hunk) => (
        <HunkRows key={`${hunk.oldStart}-${hunk.newStart}`} hunk={hunk} />
      ))}
    </table>
  )
}

function HunkRows({ hunk }: { readonly hunk: Hunk }): ReactElement {
  return (
    <tbody>
      <tr className="hunk-header">
        <td colSpan={3}>
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@ {hunk.section}
        </td>
      </tr>
      {hunk.lines.map((line, index) => (
        <LineRow key={index} line={line} />
      ))}
    </tbody>
  )
}

function LineRow({ line }: { readonly line: DiffLine }): ReactElement {
  switch (line.kind) {
    case DiffLineKind.Context:
      return <Row className="" oldLine={line.oldLine} newLine={line.newLine} marker=" " content={line.content} />
    case DiffLineKind.Added:
      return <Row className="line-added" oldLine={undefined} newLine={line.newLine} marker="+" content={line.content} />
    case DiffLineKind.Removed:
      return <Row className="line-removed" oldLine={line.oldLine} newLine={undefined} marker="-" content={line.content} />
  }
}

interface RowProps {
  readonly className: string
  readonly oldLine: number | undefined
  readonly newLine: number | undefined
  readonly marker: string
  readonly content: string
}

function Row({ className, oldLine, newLine, marker, content }: RowProps): ReactElement {
  return (
    <tr>
      <td className="line-number">{oldLine}</td>
      <td className="line-number">{newLine}</td>
      <td className={`line ${className}`}>
        <span className="marker">{marker}</span>
        {content}
      </td>
    </tr>
  )
}
