import { describe, expect, it } from "vitest"
import { neighbourTab, ReportTab, tabFromHash } from "./tabs.ts"

describe("tabFromHash", () => {
  it.each([
    ["#impact", ReportTab.Impact],
    ["#ai-review", ReportTab.AiReview],
    ["", ReportTab.Changes],
    ["#unknown", ReportTab.Changes],
  ])("reads %s", (hash, tab) => {
    expect(tabFromHash(hash)).toBe(tab)
  })
})

describe("neighbourTab", () => {
  it("wraps at both ends", () => {
    expect(neighbourTab(ReportTab.AiReview, 1)).toBe(ReportTab.Changes)
    expect(neighbourTab(ReportTab.Changes, -1)).toBe(ReportTab.AiReview)
    expect(neighbourTab(ReportTab.Impact, 1)).toBe(ReportTab.Risks)
  })
})
