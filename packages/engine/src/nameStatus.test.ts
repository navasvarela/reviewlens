import { describe, expect, it } from "vitest"
import { NameStatusParseError, parseNameStatus } from "./nameStatus.ts"

describe("parseNameStatus", () => {
  it("parses single-path and moved entries, keeping unusual file names intact", () => {
    const output = ["A", "new file.ts", "M", "src/\"quoted\"\tname.rs", "D", "gone.py", "T", "link", "R087", "old.ts", "new.ts", "C100", "a.ts", "b.ts", ""].join("\0")

    expect(parseNameStatus(output)).toEqual([
      { status: "added", path: "new file.ts" },
      { status: "modified", path: "src/\"quoted\"\tname.rs" },
      { status: "deleted", path: "gone.py" },
      { status: "typeChanged", path: "link" },
      { status: "renamed", path: "new.ts", previousPath: "old.ts", similarity: 87 },
      { status: "copied", path: "b.ts", previousPath: "a.ts", similarity: 100 },
    ])
  })

  it("returns no entries for an empty diff", () => {
    expect(parseNameStatus("")).toEqual([])
  })

  it.each([
    { name: "unknown status", output: "U\0file\0" },
    { name: "missing path", output: "M\0" },
    { name: "missing rename destination", output: "R100\0old\0" },
    { name: "invalid similarity", output: "R1x\0old\0new\0" },
  ])("rejects $name", ({ output }) => {
    expect(() => parseNameStatus(output)).toThrow(NameStatusParseError)
  })
})
