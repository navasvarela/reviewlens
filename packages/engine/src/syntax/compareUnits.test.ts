import type { ComparedUnit } from "@lens/review-model"
import { describe, expect, it } from "vitest"
import { compareUnits } from "./compareUnits.ts"
import { extractUnits } from "./definitions.ts"
import type { FileUnits } from "./definitions.ts"
import { withSyntaxTree } from "./parser.ts"
import { pythonSpec } from "./python.ts"
import { rustSpec } from "./rust.ts"
import { typescriptSpec } from "./typescript.ts"
import type { LanguageSpec } from "./languageSpec.ts"

async function unitsOf(spec: LanguageSpec, source: string | undefined): Promise<FileUnits | undefined> {
  if (source === undefined) return undefined
  return withSyntaxTree(spec, source, (tree) => extractUnits(spec, tree, source))
}

interface FileChange {
  readonly path: string
  readonly before: string | undefined
  readonly after: string | undefined
}

async function compare(spec: LanguageSpec, changes: readonly FileChange[]): Promise<Map<string, ComparedUnit[]>> {
  const files = await Promise.all(
    changes.map(async (change) => ({
      path: change.path,
      before: await unitsOf(spec, change.before),
      after: await unitsOf(spec, change.after),
    })),
  )
  return compareUnits(files)
}

/** `kind name: change[/weight]`, the shape a reviewer would scan for. */
function summarize(units: readonly ComparedUnit[] | undefined): string[] {
  return (units ?? []).map((unit) => {
    const weight = unit.change.kind === "modified" ? `/${unit.change.weight}` : ""
    return `${unit.kind} ${unit.qualifiedName}: ${unit.change.kind}${weight}`
  })
}

const LONG_BODY = "    let total = items.iter().map(|item| item.price * item.quantity).sum::<u64>();\n    total + shipping(total)\n"

describe("compareUnits", () => {
  it("reports only the method that changed, not its class", async () => {
    const result = await compare(pythonSpec, [
      {
        path: "a.py",
        before: "class A:\n    def keep(self):\n        return 1\n\n    def change(self):\n        return 1\n",
        after: "class A:\n    def keep(self):\n        return 1\n\n    def change(self):\n        return 2\n",
      },
    ])
    expect(summarize(result.get("a.py"))).toEqual(["method A.change: modified/semantic"])
  })

  it("weighs formatting-only and comment-only edits", async () => {
    const result = await compare(rustSpec, [
      {
        path: "lib.rs",
        before: "fn spaced(a: u8) -> u8 { a }\n\nfn commented() {\n    // old\n}\n",
        after: "fn spaced(a: u8) -> u8 {\n    a\n}\n\nfn commented() {\n    // new\n}\n",
      },
    ])
    expect(summarize(result.get("lib.rs"))).toEqual([
      "function spaced: modified/formattingOnly",
      "function commented: modified/commentsOnly",
    ])
  })

  it("ignores reordering and blank lines between members", async () => {
    const result = await compare(typescriptSpec, [
      {
        path: "a.ts",
        before: "export function a() { return 1 }\nexport function b() { return 2 }\n",
        after: "export function b() { return 2 }\n\n\nexport function a() { return 1 }\n",
      },
    ])
    expect(summarize(result.get("a.ts"))).toEqual([])
  })

  it("reports a new class once, not once per method", async () => {
    const result = await compare(pythonSpec, [
      { path: "a.py", before: "import os\n", after: "import os\n\nclass New:\n    def m(self):\n        pass\n" },
    ])
    expect(summarize(result.get("a.py"))).toEqual(["class New: added"])
  })

  it("detects a rename with an unchanged body", async () => {
    const result = await compare(typescriptSpec, [
      {
        path: "a.ts",
        before: "export function oldName(x: number) { return x * 2 }\n",
        after: "export function newName(x: number) { return x * 2 }\n",
      },
    ])
    const units = result.get("a.ts") ?? []
    expect(summarize(units)).toEqual(["function newName: renamed"])
    expect(units.at(0)?.change).toMatchObject({ previousName: "oldName" })
  })

  it("detects a function moved to another file", async () => {
    const result = await compare(rustSpec, [
      { path: "old.rs", before: `use x;\n\nfn total(items: &[Item]) -> u64 {\n${LONG_BODY}}\n`, after: "use x;\n" },
      { path: "new.rs", before: undefined, after: `fn total(items: &[Item]) -> u64 {\n${LONG_BODY}}\n` },
    ])
    expect(summarize(result.get("old.rs"))).toEqual(["function total: movedOut"])
    expect(summarize(result.get("new.rs"))).toEqual(["function total: movedIn"])
    expect(result.get("new.rs")?.at(0)?.change).toMatchObject({ from: { path: "old.rs", qualifiedName: "total" } })
  })

  it("does not call tiny identical bodies a move", async () => {
    const result = await compare(rustSpec, [
      { path: "a.rs", before: "fn f() {}\n", after: "" },
      { path: "b.rs", before: "", after: "fn f() {}\n" },
    ])
    expect(summarize(result.get("a.rs"))).toEqual(["function f: removed"])
    expect(summarize(result.get("b.rs"))).toEqual(["function f: added"])
  })

  it("reports import changes as a module scope change", async () => {
    const result = await compare(pythonSpec, [
      { path: "a.py", before: "import os\n\ndef f():\n    pass\n", after: "import os\nimport sys\n\ndef f():\n    pass\n" },
    ])
    expect(summarize(result.get("a.py"))).toEqual(["moduleScope (module scope): modified/semantic"])
  })

  it("treats every unit of a new file as added, with no module scope when there is none", async () => {
    const result = await compare(pythonSpec, [{ path: "new.py", before: undefined, after: "def a():\n    pass\n\ndef b():\n    pass\n" }])
    expect(summarize(result.get("new.py"))).toEqual(["function a: added", "function b: added"])
  })
})
