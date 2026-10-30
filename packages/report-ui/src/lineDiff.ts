import { diffLines } from "diff"
import type { UnitSnapshot } from "@lens/review-model"

export interface NumberedLine {
  /** Undefined where line numbers mean nothing, such as the elided module scope. */
  readonly number: number | undefined
  readonly text: string
}

export type DiffRow =
  | { readonly kind: "same"; readonly left: NumberedLine; readonly right: NumberedLine }
  | { readonly kind: "changed"; readonly left: NumberedLine | undefined; readonly right: NumberedLine | undefined }
  | { readonly kind: "elided"; readonly rows: readonly DiffRow[] }

// Unchanged lines kept visible around each change, and the shortest run worth hiding.
const CONTEXT_LINES = 3
const MIN_ELIDED_LINES = 4

/**
 * Aligns two versions of a unit into side-by-side rows. A removed block followed by an
 * added block is paired line by line, so an edited line sits next to its new version.
 * Long unchanged runs are folded into `elided` rows.
 */
export function buildRows(before: UnitSnapshot, after: UnitSnapshot, numbered: boolean): DiffRow[] {
  const rows: DiffRow[] = []
  let leftNumber = before.startLine
  let rightNumber = after.startLine
  const left = (text: string): NumberedLine => ({ number: numbered ? leftNumber++ : undefined, text })
  const right = (text: string): NumberedLine => ({ number: numbered ? rightNumber++ : undefined, text })

  let pendingRemoved: string[] = []
  const flushRemoved = (): void => {
    pendingRemoved.forEach((text) => rows.push({ kind: "changed", left: left(text), right: undefined }))
    pendingRemoved = []
  }

  // A trailing newline on both sides keeps jsdiff from treating the last line as changed.
  for (const part of diffLines(`${before.text}\n`, `${after.text}\n`)) {
    const lines = splitLines(part.value)
    if (part.removed) {
      pendingRemoved.push(...lines)
    } else if (part.added) {
      const paired = Math.max(pendingRemoved.length, lines.length)
      for (let index = 0; index < paired; index++) {
        const removedText = pendingRemoved.at(index)
        const addedText = lines.at(index)
        rows.push({
          kind: "changed",
          left: removedText === undefined ? undefined : left(removedText),
          right: addedText === undefined ? undefined : right(addedText),
        })
      }
      pendingRemoved = []
    } else {
      flushRemoved()
      lines.forEach((text) => rows.push({ kind: "same", left: left(text), right: right(text) }))
    }
  }
  flushRemoved()
  return elideUnchangedRuns(rows)
}

export function numberedLines(snapshot: UnitSnapshot, numbered: boolean): NumberedLine[] {
  return snapshot.text.split("\n").map((text, index) => ({ number: numbered ? snapshot.startLine + index : undefined, text }))
}

function elideUnchangedRuns(rows: readonly DiffRow[]): DiffRow[] {
  const result: DiffRow[] = []
  let run: DiffRow[] = []
  const flushRun = (isLast: boolean): void => {
    const keepBefore = result.length === 0 ? 0 : CONTEXT_LINES
    const keepAfter = isLast ? 0 : CONTEXT_LINES
    const hidden = run.length - keepBefore - keepAfter
    if (hidden < MIN_ELIDED_LINES) {
      result.push(...run)
    } else {
      result.push(...run.slice(0, keepBefore), { kind: "elided", rows: run.slice(keepBefore, keepBefore + hidden) }, ...run.slice(keepBefore + hidden))
    }
    run = []
  }
  for (const row of rows) {
    if (row.kind === "same") {
      run.push(row)
    } else {
      flushRun(false)
      result.push(row)
    }
  }
  flushRun(true)
  return result
}

function splitLines(value: string): string[] {
  const lines = value.split("\n")
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines
}
