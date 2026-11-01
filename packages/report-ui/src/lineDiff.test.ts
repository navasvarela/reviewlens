import { describe, expect, it } from "vitest"
import { DiffLineKind } from "@walkdiff/review-model"
import type { DiffLine, UnitSnapshot } from "@walkdiff/review-model"
import { buildRows, highlightHunkLines, numberedLines, wordMarks } from "./lineDiff.ts"
import type { DiffRow } from "./lineDiff.ts"
import { HighlightLanguage } from "./syntax/highlight.ts"
import { SyntaxKind } from "./syntax/scanner.ts"

function snapshot(text: string, startLine = 1): UnitSnapshot {
  return { text, startLine, endLine: startLine + text.split("\n").length - 1, elidesNestedUnits: false }
}

const context = (content: string): DiffLine => ({ kind: DiffLineKind.Context, oldLine: 1, newLine: 1, content })
const added = (content: string): DiffLine => ({ kind: DiffLineKind.Added, newLine: 1, content })
const removed = (content: string): DiffLine => ({ kind: DiffLineKind.Removed, oldLine: 1, content })

describe("wordMarks", () => {
  it("marks each side's own words, as offsets into its own text", () => {
    expect(wordMarks("let a = 1", "let bb = 1")).toEqual({ left: [{ start: 4, end: 5 }], right: [{ start: 4, end: 6 }] })
  })

  it("marks nothing on identical lines", () => {
    expect(wordMarks("a b", "a b")).toEqual({ left: [], right: [] })
  })

  it("leaves very long lines unmarked instead of stalling", () => {
    const long = "word ".repeat(1_000)
    expect(wordMarks(long, `${long}more`)).toEqual({ left: [], right: [] })
  })
})

describe("buildRows", () => {
  const options = { numbered: true, language: HighlightLanguage.Rust }

  it("colours a line by the context of its whole version, even when the change is further on", () => {
    const before = snapshot("/* a\nb */\nx")
    const after = snapshot("/* a\nb */\ny")
    const sameRow = buildRows(before, after, options).at(1)
    expect(sameRow).toMatchObject({ kind: "same", left: { spans: [{ kind: SyntaxKind.Comment }] }, right: { spans: [{ kind: SyntaxKind.Comment }] } })
  })

  it("keeps line numbers and colours aligned after an insertion", () => {
    const rows = buildRows(snapshot("fn"), snapshot("// new\nfn"), options)
    const lastRow: DiffRow | undefined = rows.at(-1)
    expect(lastRow).toMatchObject({ kind: "same", left: { number: 1, spans: [{ kind: SyntaxKind.Keyword }] }, right: { number: 2, spans: [{ kind: SyntaxKind.Keyword }] } })
  })

  it("colours lines folded into an elided run", () => {
    const body = Array.from({ length: 12 }, () => "fn").join("\n")
    const elided = buildRows(snapshot(`${body}\nold`), snapshot(`${body}\nnew`), options).find((row) => row.kind === "elided")
    expect(elided).toMatchObject({ rows: expect.arrayContaining([expect.objectContaining({ right: expect.objectContaining({ spans: [expect.objectContaining({ kind: SyntaxKind.Keyword })] }) })]) })
  })

  it("stays plain without a language", () => {
    expect(numberedLines(snapshot("fn a"), { numbered: false, language: undefined })).toEqual([{ number: undefined, text: "fn a", spans: [] }])
  })
})

describe("highlightHunkLines", () => {
  const language = HighlightLanguage.Rust

  it("lexes each side alone, so a comment opened on one side leaves the other alone", () => {
    const spans = highlightHunkLines([added("/* new"), removed("fn old"), context("fn both"), added("*/")], language)
    expect(spans.at(0)?.at(0)?.kind).toBe(SyntaxKind.Comment)
    expect(spans.at(1)?.at(0)?.kind).toBe(SyntaxKind.Keyword)
    expect(spans.at(2)?.at(0)?.kind).toBe(SyntaxKind.Comment)
    expect(spans.at(3)?.at(0)?.kind).toBe(SyntaxKind.Comment)
  })

  it("is plain without a language", () => {
    expect(highlightHunkLines([context("fn a")], undefined)).toEqual([[]])
  })
})
