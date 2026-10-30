import { useState } from "react"
import type { ReactElement } from "react"
import { diffWordsWithSpace } from "diff"
import type { UnitSnapshot } from "@lens/review-model"
import { buildRows, numberedLines } from "../lineDiff.ts"
import type { DiffRow, NumberedLine } from "../lineDiff.ts"
import type { Tone } from "../unitChange.ts"

interface SideBySideProps {
  readonly before: UnitSnapshot
  readonly after: UnitSnapshot
  readonly numbered: boolean
}

/** The whole unit before and after, aligned, with the changed words marked inside edited lines. */
export function SideBySide({ before, after, numbered }: SideBySideProps): ReactElement {
  const rows = buildRows(before, after, numbered)
  return (
    <table className="code side-by-side">
      <colgroup>
        <col className="line-number-column" />
        <col />
        <col className="line-number-column" />
        <col />
      </colgroup>
      <tbody>
        {rows.map((row, index) => (
          <Row key={index} row={row} />
        ))}
      </tbody>
    </table>
  )
}

function Row({ row }: { readonly row: DiffRow }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  switch (row.kind) {
    case "same":
      return (
        <tr>
          <LineCells line={row.left} className="" />
          <LineCells line={row.right} className="" />
        </tr>
      )
    case "changed":
      return <ChangedRow left={row.left} right={row.right} />
    case "elided":
      return expanded ? (
        <>
          {row.rows.map((hidden, index) => (
            <Row key={index} row={hidden} />
          ))}
        </>
      ) : (
        <tr className="elided">
          <td colSpan={4}>
            <button type="button" onClick={() => setExpanded(true)}>
              ⋯ {row.rows.length} unchanged lines
            </button>
          </td>
        </tr>
      )
  }
}

interface ChangedRowProps {
  readonly left: NumberedLine | undefined
  readonly right: NumberedLine | undefined
}

function ChangedRow({ left, right }: ChangedRowProps): ReactElement {
  if (left === undefined || right === undefined) {
    return (
      <tr>
        {left === undefined ? <EmptyCells /> : <LineCells line={left} className="line-removed" />}
        {right === undefined ? <EmptyCells /> : <LineCells line={right} className="line-added" />}
      </tr>
    )
  }
  const parts = diffWordsWithSpace(left.text, right.text)
  return (
    <tr>
      <td className="line-number">{left.number}</td>
      <td className="line line-removed">
        {parts
          .filter((part) => !part.added)
          .map((part, index) => (
            <span key={index} className={part.removed ? "word-removed" : undefined}>
              {part.value}
            </span>
          ))}
      </td>
      <td className="line-number">{right.number}</td>
      <td className="line line-added">
        {parts
          .filter((part) => !part.removed)
          .map((part, index) => (
            <span key={index} className={part.added ? "word-added" : undefined}>
              {part.value}
            </span>
          ))}
      </td>
    </tr>
  )
}

function LineCells({ line, className }: { readonly line: NumberedLine; readonly className: string }): ReactElement {
  return (
    <>
      <td className="line-number">{line.number}</td>
      <td className={`line ${className}`}>{line.text}</td>
    </>
  )
}

function EmptyCells(): ReactElement {
  return (
    <>
      <td className="line-number empty" />
      <td className="line empty" />
    </>
  )
}

interface SinglePaneProps {
  readonly snapshot: UnitSnapshot
  readonly tone: Tone
  readonly numbered: boolean
}

/** One version of a unit, for units that exist on one side only. */
export function SinglePane({ snapshot, tone, numbered }: SinglePaneProps): ReactElement {
  return (
    <table className="code single-pane">
      <colgroup>
        <col className="line-number-column" />
        <col />
      </colgroup>
      <tbody>
        {numberedLines(snapshot, numbered).map((line, index) => (
          <tr key={index}>
            <LineCells line={line} className={`line-${tone}`} />
          </tr>
        ))}
      </tbody>
    </table>
  )
}
