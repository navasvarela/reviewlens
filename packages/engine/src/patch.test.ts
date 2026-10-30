import { describe, expect, it } from "vitest"
import { parseFileContent, splitPatchByFile } from "./patch.ts"

const TWO_FILE_PATCH = [
  "diff --git a/lib.rs b/lib.rs",
  "index 1111111..2222222 100644",
  "--- a/lib.rs",
  "+++ b/lib.rs",
  "@@ -1,3 +1,3 @@ fn main() {",
  " let a = 1;",
  "-let b = 2;",
  "+let b = 3;",
  " let c = a + b;",
  "@@ -10 +10,2 @@",
  "-old",
  "+new",
  "+more",
  "\\ No newline at end of file",
  "diff --git a/logo.png b/logo.png",
  "index 3333333..4444444 100644",
  "Binary files a/logo.png and b/logo.png differ",
  "",
].join("\n")

describe("splitPatchByFile", () => {
  it("starts a new chunk at each file header", () => {
    const chunks = splitPatchByFile(TWO_FILE_PATCH)
    expect(chunks.map((chunk) => chunk.at(0))).toEqual(["diff --git a/lib.rs b/lib.rs", "diff --git a/logo.png b/logo.png"])
  })

  it("returns no chunks for an empty patch", () => {
    expect(splitPatchByFile("")).toEqual([])
  })
})

describe("parseFileContent", () => {
  const [textChunk = [], binaryChunk = []] = splitPatchByFile(TWO_FILE_PATCH)

  it("numbers lines on both sides and applies the implicit one-line range", () => {
    expect(parseFileContent(textChunk)).toEqual({
      kind: "text",
      hunks: [
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          section: "fn main() {",
          lines: [
            { kind: "context", content: "let a = 1;", oldLine: 1, newLine: 1 },
            { kind: "removed", content: "let b = 2;", oldLine: 2 },
            { kind: "added", content: "let b = 3;", newLine: 2 },
            { kind: "context", content: "let c = a + b;", oldLine: 3, newLine: 3 },
          ],
        },
        {
          oldStart: 10,
          oldLines: 1,
          newStart: 10,
          newLines: 2,
          section: "",
          lines: [
            { kind: "removed", content: "old", oldLine: 10 },
            { kind: "added", content: "new", newLine: 10 },
            { kind: "added", content: "more", newLine: 11 },
          ],
        },
      ],
    })
  })

  it("recognises binary files", () => {
    expect(parseFileContent(binaryChunk)).toEqual({ kind: "binary" })
  })

  it("treats a header-only section, such as a pure rename, as text without hunks", () => {
    expect(parseFileContent(["diff --git a/x b/y", "similarity index 100%", "rename from x", "rename to y"])).toEqual({
      kind: "text",
      hunks: [],
    })
  })
})
