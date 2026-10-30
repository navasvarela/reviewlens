import { describe, expect, it } from "vitest"
import { assembleReportPage, ReportUiFormatError } from "./report.ts"

const PAGE = [
  "<html><head>",
  '<script type="module" crossorigin src="./assets/app.js"></script>',
  '<link rel="stylesheet" crossorigin href="./assets/app.css">',
  "</head><body></body></html>",
].join("\n")

describe("assembleReportPage", () => {
  const assets = new Map([
    ["assets/app.js", 'const a = "$&"; const b = "</script>"'],
    ["assets/app.css", "body { color: red }"],
  ])

  it("inlines assets without interpreting `$` patterns or closing the script early", () => {
    const page = assembleReportPage(PAGE, assets, "{}")
    expect(page).toContain('const a = "$&"; const b = "<\\/script>"')
    expect(page).toContain("<style>body { color: red }</style>")
    expect(page).not.toContain("./assets/")
  })

  it("embeds the model so text from the PR cannot break out of its block", () => {
    const page = assembleReportPage(PAGE, assets, JSON.stringify({ code: "</script><script>alert(1)</script>" }))
    expect(page).not.toContain("<script>alert(1)")
    expect(page).toContain('{"code":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}')
  })

  it("refuses a page it does not recognise rather than producing a broken report", () => {
    expect(() => assembleReportPage("<html></html>", assets, "{}")).toThrow(ReportUiFormatError)
  })
})
