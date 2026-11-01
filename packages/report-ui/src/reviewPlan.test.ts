import { describe, expect, it } from "vitest"
import { ModificationWeight, REVIEW_MODEL_SCHEMA_VERSION, reviewModelSchema, RiskCategory, RiskSeverity, SyntaxAnalysisStatus, UnitChangeKind, UnitImpactStatus, UnitKind } from "@lens/review-model"
import type { ChangedFile, ChangedUnit, ReviewModel, Risk, UnitKind as UnitKindType } from "@lens/review-model"
import { buildReviewPlan, GuideRouteKind, guideRouteFromHash } from "./reviewPlan.ts"

const SNAPSHOT = { startLine: 1, endLine: 5, text: "body", elidesNestedUnits: false }

interface UnitOptions {
  readonly name: string
  readonly kind?: UnitKindType
  readonly callers?: number
  readonly added?: boolean
  readonly quiet?: boolean
}

function unit({ name, kind = UnitKind.Function, callers = 0, added = false, quiet = false }: UnitOptions): ChangedUnit {
  const reference = { path: "other.ts", line: 1, callerQualifiedName: null, confidence: "likely", touchedByPullRequest: false, snippet: name } as const
  return {
    kind,
    name,
    qualifiedName: name,
    change: added
      ? { kind: UnitChangeKind.Added, after: SNAPSHOT }
      : { kind: UnitChangeKind.Modified, weight: quiet ? ModificationWeight.FormattingOnly : ModificationWeight.Semantic, before: SNAPSHOT, after: SNAPSHOT },
    facts: null,
    impact: callers === 0 ? null : { status: UnitImpactStatus.Traced, searchedName: name, references: Array.from({ length: callers }, () => reference), totalReferences: callers },
  }
}

function file(path: string, units: readonly ChangedUnit[] = []): ChangedFile {
  return {
    diff: { status: "modified", path, additions: 1, deletions: 0, content: { kind: "text", hunks: [] } },
    noise: null,
    syntax: units.length === 0 ? { status: SyntaxAnalysisStatus.UnsupportedLanguage } : { status: SyntaxAnalysisStatus.Analyzed, language: "typescript", units, outline: [], calls: [] },
  }
}

function finding(category: Risk["category"], severity: Risk["severity"], title: string, path: string | null, line: number | null = null): Risk {
  return { ruleId: title, category, severity, title, detail: "", location: path === null ? null : { path, line }, evidence: null }
}

function review(files: readonly ChangedFile[], findings: readonly Risk[] = []): ReviewModel {
  // Parsing keeps this fixture honest against the real contract, without a cast.
  return reviewModelSchema.parse({
    schemaVersion: REVIEW_MODEL_SCHEMA_VERSION,
    generatedAt: "2026-10-31T00:00:00.000Z",
    pullRequest: { url: "https://github.com/o/r/pull/1", number: 1, title: "t", description: "", author: "a", baseRef: "main", headRef: "b", baseSha: "a".repeat(40), headSha: "b".repeat(40), mergeBaseSha: "c".repeat(40), repositoryWebUrl: "https://github.com/o/r", host: "github" },
    files,
    risk: { securityLevel: RiskSeverity.Low, findings, checksRun: [], notChecked: [] },
    ai: { status: "disabled" },
    feedbackUrl: null,
  })
}

const titles = (model: ReviewModel): readonly string[] => buildReviewPlan(model).stops.map((stop) => stop.title)

describe("buildReviewPlan", () => {
  it("puts a high finding ahead of everything else", () => {
    const model = review([file("a.ts", [unit({ name: "busy", callers: 20 })]), file("z.ts", [unit({ name: "flagged" })])], [finding(RiskCategory.DangerousApi, RiskSeverity.High, "eval", "z.ts", 2)])
    expect(titles(model).at(0)).toBe("flagged")
  })

  it("does not let many small findings outrank a function others depend on", () => {
    const deps = Array.from({ length: 7 }, (_, index) => finding(RiskCategory.Dependency, RiskSeverity.Low, `dep ${index}`, "package.json", 1))
    const model = review([file("package.json"), file("a.ts", [unit({ name: "busy", callers: 10 })])], deps)
    expect(titles(model)).toEqual(["busy", "package.json"])
  })

  it("ranks a function above a definition with the same number of users", () => {
    const model = review([file("a.ts", [unit({ name: "Kinds", kind: UnitKind.Enum, callers: 6 }), unit({ name: "run", callers: 6 })])])
    expect(titles(model).at(0)).toBe("run")
  })

  it("leaves out tests, formatting and top-level code with nothing wrong", () => {
    const model = review([file("src/a.test.ts", [unit({ name: "case_a" })]), file("b.ts", [unit({ name: "tidy", quiet: true }), unit({ name: "imports", kind: UnitKind.ModuleScope }), unit({ name: "real" })])])
    expect(titles(model)).toEqual(["real"])
  })

  it("explains each stop without repeating what is true of every stop", () => {
    const plan = buildReviewPlan(review([file("a.ts", [unit({ name: "run", callers: 2 })])]))
    expect(plan.stops.at(0)?.reasons).toEqual(["2 places this PR didn't change depend on it"])
  })

  it("still gives a start to a PR of only new code", () => {
    const model = review([file("a.ts", [unit({ name: "one", added: true }), unit({ name: "two", added: true }), unit({ name: "three", added: true }), unit({ name: "four", added: true })])])
    const plan = buildReviewPlan(model)
    expect(plan.stops).toHaveLength(3)
    expect(plan.lowerPriority.newCode).toBe(1)
  })

  it("caps the path and counts the rest as lower priority", () => {
    const units = Array.from({ length: 30 }, (_, index) => unit({ name: `f${index}`, callers: 5 }))
    const plan = buildReviewPlan(review([file("a.ts", units)]))
    expect(plan.stops).toHaveLength(15)
    expect(plan.lowerPriority.otherCode).toBe(15)
  })

  it("groups one decision into one check, keeps at most three, and leaves size out", () => {
    const deps = Array.from({ length: 7 }, (_, index) => finding(RiskCategory.Dependency, RiskSeverity.Low, `dep ${index}`, "package.json", 1))
    const others = ["a", "b", "c"].map((name) => finding(RiskCategory.SensitivePath, RiskSeverity.Medium, name, `${name}.ts`))
    const plan = buildReviewPlan(review([file("package.json")], [...deps, ...others, finding(RiskCategory.Size, RiskSeverity.High, "Large change", null)]))
    expect(plan.checks).toHaveLength(3)
    expect(plan.moreChecks).toBe(1)
    expect(plan.checks.every((check) => check.severity === RiskSeverity.Medium)).toBe(true)
    expect(plan.sizeNote).toBe("Large change")
  })

  it("links a check to its stop, and explains a whole-file finding in words", () => {
    const pipeline = { ...finding(RiskCategory.SensitivePath, RiskSeverity.Medium, "CI pipeline", "ci.yml"), detail: "Pipelines hold secrets. More text." }
    const plan = buildReviewPlan(review([file("ci.yml")], [pipeline]))
    expect(plan.checks.at(0)?.stopIndex).toBe(0)
    expect(plan.stops.at(0)?.reasons).toEqual(["CI pipeline: Pipelines hold secrets."])
  })

  it("shows code quality as a reason at a stop, not as a check, and below security findings", () => {
    const messy = finding(RiskCategory.CodeQuality, RiskSeverity.High, "Very long function", "messy.ts", 2)
    const risky = finding(RiskCategory.DangerousApi, RiskSeverity.Medium, "eval", "risky.ts", 2)
    const plan = buildReviewPlan(review([file("messy.ts", [unit({ name: "messy" })]), file("risky.ts", [unit({ name: "risky" })])], [messy, risky]))
    expect(plan.stops.at(0)?.title).toBe("risky")
    expect(plan.stops.find((stop) => stop.title === "messy")?.reasons).toContain("Flagged: Very long function")
    expect(plan.checks.map((check) => check.message)).toEqual([expect.stringContaining("eval")])
  })

  it("finds tests by the code they mention, in other files or the same one", () => {
    const test: ChangedFile = {
      ...file("tests/run.spec.ts"),
      diff: { status: "modified", path: "tests/run.spec.ts", additions: 1, deletions: 0, content: { kind: "text", hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, section: "", lines: [{ kind: "added", content: "parse_input()", newLine: 1 }] }] } },
    }
    const plan = buildReviewPlan(review([test, file("a.ts", [unit({ name: "parse_input", callers: 5 }), unit({ name: "untested", callers: 5 })])]))
    expect(plan.stops.find((stop) => stop.title === "parse_input")?.relatedTests).toEqual(["tests/run.spec.ts"])
    expect(plan.stops.find((stop) => stop.title === "untested")?.relatedTests).toEqual([])
  })
})

describe("guideRouteFromHash", () => {
  it.each([
    ["", { kind: GuideRouteKind.Brief }],
    ["#review", { kind: GuideRouteKind.Brief }],
    ["#review/3", { kind: GuideRouteKind.Stop, index: 3 }],
    ["#review/finish", { kind: GuideRouteKind.Finish }],
    ["#changes", undefined],
    ["#risks", undefined],
  ])("reads %j", (hash, route) => {
    expect(guideRouteFromHash(hash)).toEqual(route)
  })
})
