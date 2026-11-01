import { describe, expect, it } from "vitest"
import { codeSpan, namesOfChecks, securitySummary } from "./queries.ts"
import type { Risk } from "./schema.ts"

const named = (...names: readonly string[]) => names.map((name) => ({ name, detail: "" }))

describe("namesOfChecks", () => {
  it.each([
    [named(), ""],
    [named("Semgrep"), "Semgrep"],
    [named("Semgrep", "gitleaks"), "Semgrep and gitleaks"],
    [named("Built-in rules", "Semgrep", "gitleaks"), "Built-in rules, Semgrep and gitleaks"],
  ])("reads %j as a sentence", (checks, expected) => {
    expect(namesOfChecks(checks)).toBe(expected)
  })
})

describe("securitySummary", () => {
  const finding = (category: Risk["category"]): Risk => ({ ruleId: "r", category, severity: "low", title: "t", detail: "d", location: null, evidence: null })

  it.each<readonly [readonly Risk[], string]>([
    [[], "No security findings"],
    [[finding("codeQuality"), finding("size"), finding("breakingChange")], "No security findings"],
    [[finding("secret")], "1 security finding"],
    [[finding("secret"), finding("codeScan"), finding("codeQuality")], "2 security findings"],
  ])("counts only security findings: %j", (findings, expected) => {
    expect(securitySummary(findings)).toBe(expected)
  })
})

describe("codeSpan", () => {
  it("marks text as code, and a name can't end the span early", () => {
    expect(codeSpan("parse")).toBe("`parse`")
    expect(codeSpan("a`b\nc")).toBe("`abc`")
  })
})
