import { describe, expect, it } from "vitest"
import { ModificationWeight, SyntaxAnalysisStatus, UnitChangeKind, UnitKind } from "@lens/review-model"
import type { ChangedFile, ChangedUnit } from "@lens/review-model"
import type { ReviewPlan, ReviewStop } from "./reviewPlan.ts"
import { commentsAsMarkdown, commentsOnItems, EMPTY_REVIEW_STATE, fileProgress, isReviewed, ItemKind, itemsOfFile, nextUnreviewedStop, overallProgress, parseSavedState, pathProgress, remainingOffPath, serializeState, stopItemIds, unitItemId, withComment, withReviewed } from "./reviewProgress.ts"

const SNAPSHOT = { startLine: 1, endLine: 5, text: "body", elidesNestedUnits: false }

function unit(name: string, kind: "modified" | "added" | "formatting" = "modified"): ChangedUnit {
  return {
    kind: UnitKind.Function,
    name,
    qualifiedName: name,
    change: kind === "added" ? { kind: UnitChangeKind.Added, after: SNAPSHOT } : { kind: UnitChangeKind.Modified, weight: kind === "formatting" ? ModificationWeight.FormattingOnly : ModificationWeight.Semantic, before: SNAPSHOT, after: SNAPSHOT },
    facts: null,
    impact: null,
  }
}

function file(path: string, units: readonly ChangedUnit[] = [], noise: ChangedFile["noise"] = null): ChangedFile {
  return {
    diff: { status: "modified", path, additions: 1, deletions: 0, content: { kind: "text", hunks: [] } },
    noise,
    syntax: units.length === 0 ? { status: SyntaxAnalysisStatus.UnsupportedLanguage } : { status: SyntaxAnalysisStatus.Analyzed, language: "typescript", units, outline: [], calls: [] },
  }
}

function stop(stopFile: ChangedFile, stopUnit: ChangedUnit | null): ReviewStop {
  return { unit: stopUnit, file: stopFile, title: stopUnit?.qualifiedName ?? stopFile.diff.path, reasons: [], points: 1, findings: [], relatedTests: [] }
}

function plan(stops: readonly ReviewStop[]): ReviewPlan {
  return { stops, checks: [], moreChecks: 0, lowerPriority: { newCode: 0, otherCode: 0, quiet: 0, testFiles: 0, otherFiles: 0 }, lowerPriorityTotal: 0, sizeNote: null }
}

describe("one review record across the path and All changes", () => {
  const run = unit("run")
  const parse = unit("parse")
  const code = file("a.ts", [run, parse, unit("tidy", "formatting")])
  const readme = file("README.md")
  const files = [code, readme, file("pnpm-lock.yaml", [], { kind: "lockfile", reason: "" })]
  const path = plan([stop(code, run), stop(readme, null)])

  it("counts a change marked on the path in the file and overall", () => {
    const state = withReviewed(EMPTY_REVIEW_STATE, stopItemIds(stop(code, run)), true)
    expect(fileProgress(code, state)).toEqual({ reviewed: 1, total: 2 })
    expect(overallProgress(files, state)).toEqual({ reviewed: 1, total: 3 })
    expect(pathProgress(path, state)).toEqual({ reviewed: 1, total: 2 })
  })

  it("counts a change marked in All changes on the path", () => {
    const state = withReviewed(EMPTY_REVIEW_STATE, [unitItemId(code, run)], true)
    expect(isReviewed(stopItemIds(stop(code, run)), state)).toBe(true)
    expect(nextUnreviewedStop(path, state)).toBe(1)
  })

  it("leaves skippable files and formatting edits out of the total", () => {
    expect(itemsOfFile(files[2] ?? code)).toEqual([])
    expect(itemsOfFile(code).map((item) => item.label)).toEqual(["run", "parse"])
  })

  it("reports the path as done, and what remains outside it", () => {
    const done = withReviewed(EMPTY_REVIEW_STATE, path.stops.flatMap(stopItemIds), true)
    expect(nextUnreviewedStop(path, done)).toBeUndefined()
    expect(remainingOffPath(files, path, done)).toEqual({ [ItemKind.NewCode]: 0, [ItemKind.ChangedCode]: 1, [ItemKind.Test]: 0, [ItemKind.File]: 0 })
    expect(remainingOffPath(files, path, withReviewed(done, [unitItemId(code, parse)], true))[ItemKind.ChangedCode]).toBe(0)
  })

  it("can be unmarked", () => {
    const ids = stopItemIds(stop(code, run))
    expect(isReviewed(ids, withReviewed(withReviewed(EMPTY_REVIEW_STATE, ids, true), ids, false))).toBe(false)
  })

  it("marks everything in a file shown whole", () => {
    const whole = stop(code, null)
    expect(stopItemIds(whole)).toEqual([unitItemId(code, run), unitItemId(code, parse)])
  })

  it("separates functions that share a name", () => {
    const first = unit("same")
    const second = unit("same")
    const overloads = file("b.ts", [first, second])
    expect(unitItemId(overloads, first)).not.toBe(unitItemId(overloads, second))
  })
})

describe("comments", () => {
  const run = unit("run")
  const code = file("src/a.ts", [run])
  const readme = file("README.md")

  it("drops empty comments, and formats the rest for pasting into a PR", () => {
    let state = withComment(EMPTY_REVIEW_STATE, unitItemId(code, run), "Check the retry.")
    state = withComment(state, stopItemIds(stop(readme, null)).at(0) ?? "", "Typo.")
    expect(commentsAsMarkdown(commentsOnItems([code, readme], state))).toBe("**`run`** in `src/a.ts`\n\nCheck the retry.\n\n---\n\n**`README.md`**\n\nTypo.")
    expect(withComment(state, unitItemId(code, run), "").comments.has(unitItemId(code, run))).toBe(false)
  })

  it("ignores a comment that is only whitespace", () => {
    expect(commentsOnItems([code], withComment(EMPTY_REVIEW_STATE, unitItemId(code, run), "  \n"))).toEqual([])
  })
})

describe("saved state", () => {
  it("survives a round trip", () => {
    const state = withComment(withReviewed(EMPTY_REVIEW_STATE, ["a"], true), "a", "note")
    expect(parseSavedState(serializeState(state))).toEqual(state)
  })

  it.each([[null], ["not json"], ["[]"], ["5"], ['{"reviewed":[1],"comments":[["a"],[1,2],"x"]}']])("treats %j as nothing saved", (text) => {
    expect(parseSavedState(text)).toEqual(EMPTY_REVIEW_STATE)
  })
})
