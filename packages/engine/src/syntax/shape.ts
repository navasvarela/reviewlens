import type { UnitFacts } from "@lens/review-model"
import type { Node } from "web-tree-sitter"
import type { ShapeGrammar } from "./languageSpec.ts"

/** A function's outward form and control flow, enough to state what an edit changed. */
export interface UnitShape {
  /** Parameter name → its full text, so a changed type or default shows under the same name. */
  readonly parameters: ReadonlyMap<string, string>
  readonly returnType: string | null
  readonly calls: ReadonlySet<string>
  readonly errorPaths: number
  readonly branches: number
}

// Longer callee text is usually a chained expression; its last segment says more.
const MAX_CALLEE_TEXT = 40
const LAST_SEGMENT = /[\p{L}\p{N}_$]+$/u

export function extractShape(grammar: ShapeGrammar, definition: Node): UnitShape {
  const fn = grammar.functionNode(definition)
  const calls = callNames(grammar, fn)
  const bailOuts = calls.list.filter((name) => grammar.errorCalls.has(name)).length
  return {
    parameters: parametersOf(fn),
    // TypeScript's return type node includes its leading colon.
    returnType: squeeze(fn.childForFieldName("return_type")?.text ?? "").replace(/^:\s*/, "") || null,
    calls: new Set(calls.list),
    errorPaths: fn.descendantsOfType([...grammar.errorTypes]).length + bailOuts,
    branches: fn.descendantsOfType([...grammar.branchTypes]).length,
  }
}

/** The facts between two versions, or null when an edit changes none of them. */
export function factsBetween(before: UnitShape, after: UnitShape): UnitFacts | null {
  const facts: UnitFacts = {
    parametersAdded: [...after.parameters.keys()].filter((name) => !before.parameters.has(name)),
    parametersRemoved: [...before.parameters.keys()].filter((name) => !after.parameters.has(name)),
    parametersChanged: [...after.parameters].filter(([name, text]) => before.parameters.has(name) && before.parameters.get(name) !== text).map(([name]) => name),
    returnType: before.returnType === after.returnType ? null : { before: before.returnType, after: after.returnType },
    callsAdded: [...after.calls].filter((call) => !before.calls.has(call)),
    callsRemoved: [...before.calls].filter((call) => !after.calls.has(call)),
    errorPathsDelta: after.errorPaths - before.errorPaths,
    branchesDelta: after.branches - before.branches,
  }
  const hasAny =
    facts.parametersAdded.length + facts.parametersRemoved.length + facts.parametersChanged.length + facts.callsAdded.length + facts.callsRemoved.length > 0 ||
    facts.returnType !== null ||
    facts.errorPathsDelta !== 0 ||
    facts.branchesDelta !== 0
  return hasAny ? facts : null
}

function parametersOf(fn: Node): Map<string, string> {
  const list = fn.childForFieldName("parameters")
  // `x => x + 1` has a single parameter and no list around it.
  const single = fn.childForFieldName("parameter")
  const nodes = list === null ? (single === null ? [] : [single]) : list.namedChildren
  const parameters = new Map<string, string>()
  for (const node of nodes) {
    if (node === null || node.type.includes("comment")) continue
    parameters.set(squeeze(parameterName(node)), squeeze(node.text))
  }
  return parameters
}

function parameterName(node: Node): string {
  const named = node.childForFieldName("pattern") ?? node.childForFieldName("name")
  if (named !== null) return named.text
  // Python's `typed_parameter` has no name field: the name is its first child.
  return node.type.includes("typed") ? (node.firstNamedChild?.text ?? node.text) : node.text
}

interface CallNames {
  /** With repeats, so repeated bail-outs each count as an error path. */
  readonly list: readonly string[]
}

function callNames(grammar: ShapeGrammar, fn: Node): CallNames {
  const list = fn.descendantsOfType([...grammar.calls.keys()]).flatMap((call) => {
    const syntax = call === null ? undefined : grammar.calls.get(call.type)
    const callee = syntax === undefined ? null : (call?.childForFieldName(syntax.calleeField) ?? null)
    return syntax === undefined || callee === null ? [] : [`${calleeName(callee)}${syntax.suffix}`]
  })
  return { list }
}

function calleeName(callee: Node): string {
  // Chained calls span lines; `items\n  .iter` is the callee `items.iter`.
  const text = callee.text.replace(/\s+/g, "")
  if (text.length <= MAX_CALLEE_TEXT && !text.includes("(")) return text
  return LAST_SEGMENT.exec(text)?.[0] ?? text.slice(0, MAX_CALLEE_TEXT)
}

function squeeze(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}
