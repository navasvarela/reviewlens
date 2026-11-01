import { describe, expect, it } from "vitest"
import { ModificationWeight, UnitChangeKind, UnitImpactStatus, UnitKind } from "@walkdiff/review-model"
import type { ChangedUnit, UnitChange, UnitImpact } from "@walkdiff/review-model"
import { impactHeadline } from "./impactHeadline.ts"

const SNAPSHOT = { startLine: 1, endLine: 2, text: "x", elidesNestedUnits: false }
const MODIFIED: UnitChange = { kind: UnitChangeKind.Modified, weight: ModificationWeight.Semantic, before: SNAPSHOT, after: SNAPSHOT }
const REMOVED: UnitChange = { kind: UnitChangeKind.Removed, before: SNAPSHOT }
const RENAMED: UnitChange = { kind: UnitChangeKind.Renamed, previousName: "old", before: SNAPSHOT, after: SNAPSHOT }

function traced(untouched: number, touched = 0): UnitImpact {
  const reference = (touchedByPullRequest: boolean) => ({ path: "a.ts", line: 1, callerQualifiedName: null, confidence: "likely", touchedByPullRequest, snippet: "x" }) as const
  return {
    status: UnitImpactStatus.Traced,
    searchedName: "run",
    references: [...Array.from({ length: untouched }, () => reference(false)), ...Array.from({ length: touched }, () => reference(true))],
    totalReferences: untouched + touched,
  }
}

function unit(change: UnitChange, impact: UnitImpact): ChangedUnit {
  return { kind: UnitKind.Function, name: "run", qualifiedName: "run", change, facts: null, impact }
}

describe("impactHeadline", () => {
  it.each([
    ["a function others use", MODIFIED, traced(3), "3 places this PR didn't change use it", "attention"],
    ["one user", MODIFIED, traced(1), "1 place this PR didn't change uses it", "attention"],
    ["callers all updated", MODIFIED, traced(0, 2), "Used in 2 places, all updated in this PR", "quiet"],
    ["a removal still in use", REMOVED, traced(2), "Removed, but 2 places this PR didn't change still use the old name", "warning"],
    ["a rename still in use", RENAMED, traced(1), "Renamed, but 1 place this PR didn't change still uses the old name", "warning"],
    ["a clean removal", REMOVED, traced(0), "Removed, and nothing still uses the old name", "quiet"],
    ["a rename with every use updated", RENAMED, traced(0, 4), "Used in 4 places, all updated in this PR", "quiet"],
    ["a name too common to trace", MODIFIED, { status: UnitImpactStatus.TooCommon, searchedName: "get", matchingFiles: 900 }, "Name too common to trace callers", "quiet"],
    ["an untraced change", MODIFIED, { status: UnitImpactStatus.Skipped, searchedName: "x", reason: "r" }, "Callers weren't traced", "quiet"],
  ] as const)("describes %s", (_name, change, impact, text, tone) => {
    expect(impactHeadline(unit(change, impact), impact)).toEqual({ text, tone })
  })
})
