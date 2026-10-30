import { describe, expect, it } from "vitest"
import type { LanguageSpec } from "../syntax/languageSpec.ts"
import { withSyntaxTree } from "../syntax/parser.ts"
import { pythonSpec } from "../syntax/python.ts"
import { rustSpec } from "../syntax/rust.ts"
import { typescriptSpec } from "../syntax/typescript.ts"
import { findIdentifierUses } from "./identifierUses.ts"

function usesOf(spec: LanguageSpec, source: string, name: string): Promise<string[]> {
  return withSyntaxTree(spec, source, (tree) =>
    findIdentifierUses(spec, tree, new Set([name])).map((occurrence) => {
      const detail = "qualifier" in occurrence.use ? occurrence.use.qualifier : "receiver" in occurrence.use ? occurrence.use.receiver : ""
      return `${occurrence.line} ${occurrence.use.kind}${detail === "" ? "" : ` ${detail}`}`
    }),
  )
}

describe("findIdentifierUses", () => {
  it("skips parameters and locals that shadow the name, in TypeScript", async () => {
    const source = [
      "const handler = (issue) => issue.code",
      "function report(issue: Issue) { return issue }",
      "function other() { const issue = 1; return issue }",
      "issue()",
      "util.issue(1)",
    ].join("\n")
    expect(await usesOf(typescriptSpec, source, "issue")).toEqual(["4 bare", "5 member util"])
  })

  it("skips parameters, keyword arguments and import aliases, in Python", async () => {
    const source = [
      "from .core import parse as parse",
      "def run(parse):",
      "    return parse(1)",
      "def go():",
      "    return parse(2, parse=3)",
    ].join("\n")
    expect(await usesOf(pythonSpec, source, "parse")).toEqual(["1 bare", "5 bare"])
  })

  it("skips impl headers and closure parameters but keeps type and path uses, in Rust", async () => {
    const source = [
      "impl Opts { fn x(&self) {} }",
      "fn take(opts: Opts) -> Opts { Opts::default() }",
      "fn closure() { let f = |Opts| Opts; }",
    ].join("\n")
    // Parameter type, return type, and the qualifier of `Opts::default()`.
    expect(await usesOf(rustSpec, source, "Opts")).toEqual(["2 bare", "2 bare", "2 bare"])
  })

  it("never counts mentions in comments or strings", async () => {
    expect(await usesOf(typescriptSpec, '// parse here\nconst s = "parse"\n', "parse")).toEqual([])
  })
})
