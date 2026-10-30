import { describe, expect, it } from "vitest"
import { changesCount, neighbourTab, ReportTab, tabFromHash } from "./tabs.ts"

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

describe("changesCount", () => {
  it("names both numbers, in the singular when it is one", () => {
    expect(changesCount(10, 43)).toBe("10 files · 43 units")
    expect(changesCount(1, 1)).toBe("1 file · 1 unit")
  })
})
