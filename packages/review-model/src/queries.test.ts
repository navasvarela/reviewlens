import { describe, expect, it } from "vitest"
import { namesOfChecks } from "./queries.ts"

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
