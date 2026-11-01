import type { ComparedUnit, UnitFacts } from "@lens/review-model"
import { describe, expect, it } from "vitest"
import { compareUnits } from "./compareUnits.ts"
import { extractUnits } from "./definitions.ts"
import type { FileUnits } from "./definitions.ts"
import { orderUnits, outlineOf, unitCalls } from "./fileStructure.ts"
import type { LanguageSpec } from "./languageSpec.ts"
import { withSyntaxTree } from "./parser.ts"
import { pythonSpec } from "./python.ts"
import { rustSpec } from "./rust.ts"
import { typescriptSpec } from "./typescript.ts"

function unitsOf(spec: LanguageSpec, source: string): Promise<FileUnits> {
  return withSyntaxTree(spec, source, (tree) => extractUnits(spec, tree, source))
}

async function compare(spec: LanguageSpec, before: string, after: string): Promise<{ units: ComparedUnit[]; head: FileUnits }> {
  const head = await unitsOf(spec, after)
  const compared = compareUnits([{ path: "f", before: await unitsOf(spec, before), after: head }])
  return { units: compared.get("f") ?? [], head }
}

async function factsOf(spec: LanguageSpec, before: string, after: string): Promise<UnitFacts | null | undefined> {
  return (await compare(spec, before, after)).units.at(0)?.facts
}

describe("change facts", () => {
  it("reads parameters, return type, calls, error paths and branches in Python", async () => {
    const facts = await factsOf(
      pythonSpec,
      "def fetch(url, retries=1):\n    return get(url)\n",
      "def fetch(url, retries=3, timeout: int = 5) -> str:\n    if not url:\n        raise ValueError(url)\n    log(url)\n    return post(url)\n",
    )
    expect(facts).toEqual({
      parametersAdded: ["timeout"],
      parametersRemoved: [],
      parametersChanged: ["retries"],
      returnType: { before: null, after: "str" },
      callsAdded: ["ValueError", "log", "post"],
      callsRemoved: ["get"],
      errorPathsDelta: 1,
      branchesDelta: 1,
      complexity: { before: 1, after: 2 },
    })
  })

  it("counts Rust's ? and panic-like macros as error paths", async () => {
    const facts = await factsOf(rustSpec, "fn load(p: &str) -> u8 {\n    read(p)\n}\n", 'fn load(p: &Path) -> Result<u8> {\n    let v = read(p)?;\n    if v == 0 {\n        panic!("zero");\n    }\n    Ok(v)\n}\n')
    expect(facts).toMatchObject({
      parametersChanged: ["p"],
      returnType: { before: "u8", after: "Result<u8>" },
      callsAdded: ["panic!", "Ok"],
      errorPathsDelta: 2,
      branchesDelta: 1,
    })
  })

  it("reads an arrow function assigned to a const in TypeScript", async () => {
    const facts = await factsOf(typescriptSpec, "export const add = (a: number) => a + 1\n", "export const add = (a: number, b: number): number => { if (b < 0) throw new Error('neg'); return a + b }\n")
    expect(facts).toMatchObject({ parametersAdded: ["b"], returnType: { before: null, after: "number" }, callsAdded: ["Error"], errorPathsDelta: 1, branchesDelta: 1 })
  })

  it("names a chained call without the line break inside it", async () => {
    const facts = await factsOf(rustSpec, "fn f(v: V) -> u8 {\n    1\n}\n", "fn f(v: V) -> u8 {\n    v\n        .iter()\n}\n")
    expect(facts?.callsAdded).toEqual(["v.iter"])
  })

  it("has nothing to state when the edit changes none of the facts", async () => {
    expect(await factsOf(pythonSpec, "def f(a):\n    return a + 1\n", "def f(a):\n    return a + 2\n")).toBeNull()
  })

  it("leaves types and formatting-only edits without facts", async () => {
    expect(await factsOf(rustSpec, "struct S { a: u8 }\n", "struct S { a: u16 }\n")).toBeNull()
    expect(await factsOf(pythonSpec, "def f(a):\n    return g( a )\n", "def f(a):\n    return g(a)\n")).toBeNull()
  })
})

describe("file structure", () => {
  const BEFORE = ["def low():", "    return 1", "", "def mid():", "    return low()", "", "def top():", "    return mid()", "", "def same():", "    return 0", ""].join("\n")
  const AFTER = ["def low():", "    return 2", "", "def mid():", "    return low() + 1", "", "def top():", "    return mid() + 1", "", "def same():", "    return 0", ""].join("\n")

  it("outlines every definition in the head version", async () => {
    const { head } = await compare(pythonSpec, BEFORE, AFTER)
    expect(outlineOf(head).map((entry) => `${entry.qualifiedName}:${entry.startLine}-${entry.endLine}`)).toEqual(["low:1-2", "mid:4-5", "top:7-8", "same:10-11"])
  })

  it("links changed units that call each other, leaving out unchanged ones", async () => {
    const { units, head } = await compare(pythonSpec, BEFORE, AFTER)
    expect(unitCalls(head, units)).toEqual([
      { caller: "mid", callee: "low" },
      { caller: "top", callee: "mid" },
    ])
  })

  it("does not link a name shared by two changed units", async () => {
    const before = "class A:\n    def run(self):\n        return 1\n\nclass B:\n    def run(self):\n        return 1\n\ndef go(a):\n    return a.run()\n"
    const after = before.replaceAll("return 1", "return 2").replace("a.run()", "a.run() + 1")
    const { units, head } = await compare(pythonSpec, before, after)
    expect(unitCalls(head, units)).toEqual([])
  })

  it("does not link a path that names a different type", async () => {
    const before = "struct A;\nimpl A {\n    fn new() -> u8 { 1 }\n    fn make() -> u8 { Self::new() }\n    fn other() -> u8 { B::new() }\n}\n"
    const after = "struct A;\nimpl A {\n    fn new() -> u8 { 2 }\n    fn make() -> u8 { Self::new() + 1 }\n    fn other() -> u8 { B::new() + 1 }\n}\n"
    const { units, head } = await compare(rustSpec, before, after)
    expect(unitCalls(head, units)).toEqual([{ caller: "A::make", callee: "A::new" }])
  })

  it("orders helpers before callers, whatever the file order", async () => {
    const before = "def top():\n    return mid()\n\ndef mid():\n    return low()\n\ndef low():\n    return 1\n"
    const after = "def top():\n    return mid() + 1\n\ndef mid():\n    return low() + 1\n\ndef low():\n    return 2\n"
    const { units, head } = await compare(pythonSpec, before, after)
    expect(orderUnits(units, unitCalls(head, units)).map((unit) => unit.qualifiedName)).toEqual(["low", "mid", "top"])
  })

  it("puts top-level code and types first and quiet changes last, and survives call cycles", async () => {
    const before = "import os\n\ndef a():\n    return b()\n\ndef b():\n    return a()\n\ndef tidy(x):\n    return x\n\nclass Config:\n    x = 1\n"
    const after = "import os\nimport sys\n\ndef a():\n    return b() + 1\n\ndef b():\n    return a() + 1\n\ndef tidy(x):\n    return  x\n\nclass Config:\n    x = 2\n"
    const { units, head } = await compare(pythonSpec, before, after)
    expect(orderUnits(units, unitCalls(head, units)).map((unit) => unit.qualifiedName)).toEqual(["(module scope)", "Config", "b", "a", "tidy"])
  })
})
