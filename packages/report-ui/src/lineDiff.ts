import { diffLines, diffWordsWithSpace } from "diff"
import { DiffLineKind } from "@walkdiff/review-model"
import type { DiffLine, UnitSnapshot } from "@walkdiff/review-model"
import { highlightLines, NO_SPANS } from "./syntax/highlight.ts"
import type { HighlightLanguage, LineSpans, TextRange } from "./syntax/highlight.ts"

export interface NumberedLine {
  /** Undefined where line numbers mean nothing, such as the elided module scope. */
  readonly number: number | undefined
  readonly text: string
  readonly spans: LineSpans
}

export interface RowOptions {
  readonly numbered: boolean
  readonly language: HighlightLanguage | undefined
}

export interface WordMarks {
  readonly left: readonly TextRange[]
  readonly right: readonly TextRange[]
}

export type DiffRow =
  | { readonly kind: "same"; readonly left: NumberedLine; readonly right: NumberedLine }
  | { readonly kind: "changed"; readonly left: NumberedLine | undefined; readonly right: NumberedLine | undefined }
  | { readonly kind: "elided"; readonly rows: readonly DiffRow[] }

// Unchanged lines kept visible around each change, and the shortest run worth hiding.
const CONTEXT_LINES = 3
const MIN_ELIDED_LINES = 4
// jsdiff's run time grows with the square of the words that differ, so a pair of long unrelated
// lines stalls the page. Past this length the row still shows as changed, without word marks.
const MAX_WORD_DIFF_LINE_CHARS = 2_000

/**
 * Aligns two versions of a unit into side-by-side rows. A removed block followed by an
 * added block is paired line by line, so an edited line sits next to its new version.
 * Long unchanged runs are folded into `elided` rows.
 */
export function buildRows(before: UnitSnapshot, after: UnitSnapshot, { numbered, language }: RowOptions): DiffRow[] {
  const rows: DiffRow[] = []
  const left = lineNumberer(before, { numbered, language })
  const right = lineNumberer(after, { numbered, language })

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

export function numberedLines(snapshot: UnitSnapshot, options: RowOptions): NumberedLine[] {
  return snapshot.text.split("\n").map(lineNumberer(snapshot, options))
}

/** Numbers and colours a snapshot's lines as they are read in order, from colours worked out on the whole text. */
function lineNumberer(snapshot: UnitSnapshot, { numbered, language }: RowOptions): (text: string) => NumberedLine {
  const spans = highlightLines(snapshot.text, language)
  let index = 0
  return (text) => {
    const line = { number: numbered ? snapshot.startLine + index : undefined, text, spans: spans.at(index) ?? NO_SPANS }
    index++
    return line
  }
}

/** Where each side of an edited line differs from the other, as offsets into that side's text. */
export function wordMarks(left: string, right: string): WordMarks {
  if (left.length > MAX_WORD_DIFF_LINE_CHARS || right.length > MAX_WORD_DIFF_LINE_CHARS) return { left: [], right: [] }
  const leftMarks: TextRange[] = []
  const rightMarks: TextRange[] = []
  let leftOffset = 0
  let rightOffset = 0
  for (const part of diffWordsWithSpace(left, right)) {
    const length = part.value.length
    if (!part.added) {
      if (part.removed) leftMarks.push({ start: leftOffset, end: leftOffset + length })
      leftOffset += length
    }
    if (!part.removed) {
      if (part.added) rightMarks.push({ start: rightOffset, end: rightOffset + length })
      rightOffset += length
    }
  }
  return { left: leftMarks, right: rightMarks }
}

/**
 * Colours a hunk's lines, returning spans by line index. Each side is lexed alone, because a
 * comment opened on an added line must not recolour the removed lines beside it. A hunk starts
 * wherever git cut the file, so it can open inside a comment or string and show that stretch
 * wrongly. Only unit views, which always start at a definition, are free of this.
 */
export function highlightHunkLines(lines: readonly DiffLine[], language: HighlightLanguage | undefined): readonly LineSpans[] {
  const oldSpans = highlightSide(lines, DiffLineKind.Added, language)
  const newSpans = highlightSide(lines, DiffLineKind.Removed, language)
  return lines.map((line, index) => (line.kind === DiffLineKind.Removed ? oldSpans : newSpans).at(index) ?? NO_SPANS)
}

function highlightSide(lines: readonly DiffLine[], otherSide: DiffLineKind, language: HighlightLanguage | undefined): readonly LineSpans[] {
  const indexes = lines.flatMap((line, index) => (line.kind === otherSide ? [] : [index]))
  const spans = highlightLines(indexes.map((index) => lines.at(index)?.content ?? "").join("\n"), language)
  const byLine = new Array<LineSpans>(lines.length).fill(NO_SPANS)
  indexes.forEach((lineIndex, sideIndex) => {
    byLine[lineIndex] = spans.at(sideIndex) ?? NO_SPANS
  })
  return byLine
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
