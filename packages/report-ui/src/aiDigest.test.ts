import { describe, expect, it } from "vitest"
import type { AiReview, Citation, ChangedFile, ChangedUnit } from "@walkdiff/review-model"
import { aiNotesForStop, digestAiReview } from "./aiDigest.ts"
import type { ReviewStop } from "./reviewPlan.ts"

const citation = (path: string, startLine: number, endLine = startLine): Citation => ({ path, side: "after", startLine, endLine })

const AI: AiReview = {
  status: "completed",
  model: "m",
  chapters: [],
  intent: [
    { claim: "Adds retries", verdict: "matches", explanation: "It does.", citations: [citation("a.ts", 2)] },
    { claim: "Caps at 3", verdict: "contradicts", explanation: "It caps at 5.", citations: [citation("a.ts", 3)] },
    { claim: "Logs failures", verdict: "notFound", explanation: "No logging.", citations: [] },
  ],
  questions: [
    { question: "Is 5 safe?", why: "Load.", citations: [citation("a.ts", 4)] },
    { question: "Elsewhere?", why: "Other file.", citations: [citation("b.ts", 3)] },
    { question: "Past the end?", why: "Other lines.", citations: [citation("a.ts", 90)] },
  ],
  droppedStatements: 0,
  unitsSummarizedOnly: 0,
  usage: { inputTokens: 1, outputTokens: 1 },
  estimatedCostUsd: null,
  cached: false,
}

const SNAPSHOT = { startLine: 1, endLine: 10, text: "x", elidesNestedUnits: false }
const UNIT: ChangedUnit = { kind: "function", name: "run", qualifiedName: "run", change: { kind: "added", after: SNAPSHOT }, facts: null, impact: null }

function stop(unit: ChangedUnit | null): ReviewStop {
  const file: ChangedFile = { diff: { status: "modified", path: "a.ts", additions: 1, deletions: 0, content: { kind: "text", hunks: [] } }, noise: null, syntax: { status: "unsupportedLanguage" } }
  return { unit, file, title: "run", reasons: [], points: 0, findings: [], relatedTests: [], coverage: null }
}

describe("digestAiReview", () => {
  it("separates what differs from what matches", () => {
    const digest = digestAiReview(AI)
    expect(digest?.mismatches.map((finding) => finding.claim)).toEqual(["Caps at 3", "Logs failures"])
    expect(digest?.matches.map((finding) => finding.claim)).toEqual(["Adds retries"])
  })

  it.each<AiReview>([{ status: "disabled" }, { status: "unavailable", reason: "r" }])("has nothing to say when the review is %j", (ai) => {
    expect(digestAiReview(ai)).toBeUndefined()
  })
})

describe("aiNotesForStop", () => {
  it("keeps differences and questions citing this change's lines, leaving matches out", () => {
    expect(aiNotesForStop(AI, stop(UNIT)).map((note) => note.title)).toEqual(["Caps at 3", "Is 5 safe?"])
  })

  it("uses the whole file for a stop with no unit", () => {
    expect(aiNotesForStop(AI, stop(null)).map((note) => note.title)).toEqual(["Caps at 3", "Is 5 safe?", "Past the end?"])
  })

  it("ignores a citation of the old lines when the code is new", () => {
    const before: AiReview = { ...AI, intent: [], questions: [{ question: "Old?", why: "w", citations: [{ path: "a.ts", side: "before", startLine: 2, endLine: 2 }] }] }
    expect(aiNotesForStop(before, stop(UNIT))).toEqual([])
  })
})
