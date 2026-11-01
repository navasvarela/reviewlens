import { describe, expect, it } from "vitest"
import { ModificationWeight, SyntaxAnalysisStatus, UnitChangeKind, UnitKind } from "@walkdiff/review-model"
import type { ChangedFile, ChangedUnit } from "@walkdiff/review-model"
import type { ReviewPlan, ReviewStop } from "./reviewPlan.ts"
import { changedSinceReview, commentsAsMarkdown, commentsOnItems, EMPTY_REVIEW_STATE, fileProgress, isReviewed, ItemKind, itemsOfFile, nextUnreviewedStop, overallProgress, parseSavedState, pathProgress, remainingOffPath, serializeState, stopItems, unitItem, unitItemId, withChangedFirst, withComment, withReviewed } from "./reviewProgress.ts"

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
  return { unit: stopUnit, file: stopFile, title: stopUnit?.qualifiedName ?? stopFile.diff.path, reasons: [], points: 1, findings: [], relatedTests: [], coverage: null }
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
    const state = withReviewed(EMPTY_REVIEW_STATE, stopItems(stop(code, run)), true)
    expect(fileProgress(code, state)).toEqual({ reviewed: 1, total: 2 })
    expect(overallProgress(files, state)).toEqual({ reviewed: 1, total: 3 })
    expect(pathProgress(path, state)).toEqual({ reviewed: 1, total: 2 })
  })

  it("counts a change marked in All changes on the path", () => {
    const state = withReviewed(EMPTY_REVIEW_STATE, [unitItem(code, run)], true)
    expect(isReviewed(stopItems(stop(code, run)), state)).toBe(true)
    expect(nextUnreviewedStop(path, state)).toBe(1)
  })

  it("leaves skippable files and formatting edits out of the total", () => {
    expect(itemsOfFile(files[2] ?? code)).toEqual([])
    expect(itemsOfFile(code).map((item) => item.label)).toEqual(["run", "parse"])
  })

  it("reports the path as done, and what remains outside it", () => {
    const done = withReviewed(EMPTY_REVIEW_STATE, path.stops.flatMap((one) => stopItems(one)), true)
    expect(nextUnreviewedStop(path, done)).toBeUndefined()
    expect(remainingOffPath(files, path, done)).toEqual({ [ItemKind.NewCode]: 0, [ItemKind.ChangedCode]: 1, [ItemKind.Test]: 0, [ItemKind.File]: 0 })
    expect(remainingOffPath(files, path, withReviewed(done, [unitItem(code, parse)], true))[ItemKind.ChangedCode]).toBe(0)
  })

  it("can be unmarked", () => {
    const items = stopItems(stop(code, run))
    expect(isReviewed(items, withReviewed(withReviewed(EMPTY_REVIEW_STATE, items, true), items, false))).toBe(false)
  })

  it("marks everything in a file shown whole", () => {
    const whole = stop(code, null)
    expect(stopItems(whole).map((item) => item.id)).toEqual([unitItemId(code, run), unitItemId(code, parse)])
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
    state = withComment(state, stopItems(stop(readme, null)).at(0)?.id ?? "", "Typo.")
    expect(commentsAsMarkdown(commentsOnItems([code, readme], state))).toBe("**`run`** in `src/a.ts`\n\nCheck the retry.\n\n---\n\n**`README.md`**\n\nTypo.")
    expect(withComment(state, unitItemId(code, run), "").comments.has(unitItemId(code, run))).toBe(false)
  })

  it("ignores a comment that is only whitespace", () => {
    expect(commentsOnItems([code], withComment(EMPTY_REVIEW_STATE, unitItemId(code, run), "  \n"))).toEqual([])
  })
})

describe("saved state", () => {
  it("survives a round trip", () => {
    const run = unit("run")
    const item = unitItem(file("a.ts", [run]), run)
    const state = withComment(withReviewed(EMPTY_REVIEW_STATE, [item], true), item.id, "note")
    expect(parseSavedState(serializeState(state))).toEqual(state)
  })

  it.each([[null], ["not json"], ["[]"], ["5"], ['{"reviewed":[1],"comments":[["a"],[1,2],"x"]}']])("treats %j as nothing saved", (text) => {
    expect(parseSavedState(text)).toEqual(EMPTY_REVIEW_STATE)
  })
})

describe("after a new push", () => {
  const SNAPSHOT_AFTER = { startLine: 40, endLine: 44, text: "new body", elidesNestedUnits: false }
  const pushed = (name: string, snapshot: typeof SNAPSHOT): ChangedUnit => ({ ...unit(name), change: { kind: UnitChangeKind.Modified, weight: ModificationWeight.Semantic, before: SNAPSHOT, after: snapshot } })
  const run = unit("run")
  const steady = unit("steady")
  const firstPush = file("a.ts", [run, steady])
  const reviewedOnce = withReviewed(EMPTY_REVIEW_STATE, itemsOfFile(firstPush), true)
  const secondRun = pushed("run", SNAPSHOT_AFTER)
  const secondPush = file("a.ts", [secondRun, steady])

  it("keeps the tick on what didn't change, and removes it from what did", () => {
    const [newRun, sameSteady] = itemsOfFile(secondPush)
    expect(newRun !== undefined && isReviewed([newRun], reviewedOnce)).toBe(false)
    expect(sameSteady !== undefined && isReviewed([sameSteady], reviewedOnce)).toBe(true)
    expect(fileProgress(secondPush, reviewedOnce)).toEqual({ reviewed: 1, total: 2 })
  })

  it("keeps the tick when code only moved down the file", () => {
    const moved = pushed("run", { ...SNAPSHOT, startLine: 90, endLine: 94 })
    const movedFile = file("a.ts", [moved, steady])
    expect(changedSinceReview([movedFile], reviewedOnce)).toEqual([])
  })

  it("lists what changed, and keeps the version that was reviewed", () => {
    const changed = changedSinceReview([secondPush], reviewedOnce)
    expect(changed.map((item) => item.label)).toEqual(["run"])
    expect(reviewedOnce.reviewed.get(unitItemId(secondPush, secondRun))?.snapshot?.text).toBe("body")
  })

  it("doesn't call something changed if it was never reviewed", () => {
    expect(changedSinceReview([secondPush], EMPTY_REVIEW_STATE)).toEqual([])
  })

  it("puts changed work first with a reason, even if it wasn't on the path", () => {
    const onPath = plan([stop(secondPush, steady)])
    const reordered = withChangedFirst(onPath, changedSinceReview([secondPush], reviewedOnce), (item) => stop(item.file, item.unit))
    expect(reordered.stops.map((one) => one.title)).toEqual(["run", "steady"])
    expect(reordered.stops.at(0)?.reasons.at(0)).toContain("earlier version")
  })

  it("leaves the path alone when nothing changed", () => {
    const onPath = plan([stop(firstPush, run)])
    expect(withChangedFirst(onPath, [], (item) => stop(item.file, item.unit))).toBe(onPath)
  })

  it("ignores state saved in the older format", () => {
    expect(parseSavedState('{"reviewed":["a","b"],"comments":[]}').reviewed.size).toBe(0)
  })
})
