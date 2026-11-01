import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FileDiff } from "@walkdiff/review-model"
import { describe, expect, it } from "vitest"
import { coverageOfAddedLines, CoverageFileError, parseCoverage, readCoverage } from "./readCoverage.ts"

function diffAdding(path: string, lines: readonly number[]): FileDiff {
  return {
    status: "modified",
    path,
    additions: lines.length,
    deletions: 0,
    content: { kind: "text", hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: lines.length, section: "", lines: lines.map((newLine) => ({ kind: "added", content: "x", newLine })) }] },
  }
}

const LCOV = "TN:\nSF:src/a.ts\nDA:1,3\nDA:2,0\nDA:9,1\nend_of_record\nSF:src/b.ts\nDA:1,1\nend_of_record\n"
const COBERTURA = `<?xml version="1.0"?><coverage line-rate="0.5"><packages><package name="p"><classes>
<class name="a" filename="src/a.ts" line-rate="0.5"><methods/><lines><line number="1" hits="3"/><line number="2" hits="0" branch="false"/></lines></class>
<class name="q" filename="src/q&amp;r.py"><lines><line hits="9" number="7"/></lines></class>
</classes></package></packages></coverage>`

describe("parseCoverage", () => {
  it("reads LCOV", () => {
    const hits = parseCoverage(LCOV, "lcov.info")
    expect(hits.get("src/a.ts")?.get(1)).toBe(3)
    expect(hits.get("src/a.ts")?.get(2)).toBe(0)
  })

  it("reads Cobertura, in either attribute order, and unescapes paths", () => {
    const hits = parseCoverage(COBERTURA, "coverage.xml")
    expect(hits.get("src/a.ts")?.get(2)).toBe(0)
    expect(hits.get("src/q&r.py")?.get(7)).toBeUndefined()
  })

  it("counts a line as run if any shard ran it", () => {
    const hits = parseCoverage("SF:a.ts\nDA:1,0\nend_of_record\nSF:a.ts\nDA:1,2\nend_of_record\n", "lcov.info")
    expect(hits.get("a.ts")?.get(1)).toBe(2)
  })

  it.each(["{}", "", "<html></html>"])("refuses %j with a clear message", (text) => {
    expect(() => parseCoverage(text, "report.txt")).toThrow(CoverageFileError)
  })
})

describe("coverageOfAddedLines", () => {
  const hits = parseCoverage(LCOV, "lcov.info")

  it("keeps only lines the PR added, and ignores lines that can't run", () => {
    expect(coverageOfAddedLines(hits, [diffAdding("src/a.ts", [1, 2, 5])], "lcov.info")).toEqual({ source: "lcov.info", files: [{ path: "src/a.ts", coveredLines: [1], uncoveredLines: [2] }] })
  })

  it.each([
    ["an absolute path from CI", "/home/ci/work/src/a.ts", "src/a.ts"],
    ["a path relative to one package", "src/a.ts", "packages/app/src/a.ts"],
    ["Windows separators", "C:\\work\\src\\a.ts", "src/a.ts"],
    ["a leading dot", "./src/a.ts", "src/a.ts"],
  ])("matches %s", (_name, reported, changed) => {
    const result = coverageOfAddedLines(new Map([[reported, new Map([[1, 1]])]]), [diffAdding(changed, [1])], "x")
    expect(result.files.at(0)?.coveredLines).toEqual([1])
  })

  it("refuses to guess between two files with the same ending", () => {
    const ambiguous = new Map([["a/src/x.ts", new Map([[1, 1]])], ["b/src/x.ts", new Map([[1, 0]])]])
    expect(coverageOfAddedLines(ambiguous, [diffAdding("src/x.ts", [1])], "x").files).toEqual([])
  })

  it("doesn't match a similar file name", () => {
    expect(coverageOfAddedLines(new Map([["notsrc/a.ts", new Map([[1, 1]])]]), [diffAdding("src/a.ts", [1])], "x").files).toEqual([])
  })

  it("leaves out files the report doesn't cover", () => {
    expect(coverageOfAddedLines(hits, [diffAdding("other.ts", [1])], "x").files).toEqual([])
  })
})

describe("readCoverage", () => {
  it("explains a missing file", async () => {
    await expect(readCoverage("/no/such/file", [])).rejects.toThrow("Could not read the coverage file")
  })

  it("reads a real file, naming only its file name as the source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "walkdiff-coverage-"))
    await writeFile(join(dir, "lcov.info"), LCOV)
    expect((await readCoverage(join(dir, "lcov.info"), [])).source).toBe("lcov.info")
    await rm(dir, { recursive: true, force: true })
  })
})
