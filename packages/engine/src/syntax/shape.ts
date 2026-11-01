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
  readonly metrics: FunctionMetrics
}

/** How hard a function is to read, for spotting when a change makes one worse. */
export interface FunctionMetrics {
  /** Cyclomatic complexity: one path through the function, plus one per decision point. */
  readonly complexity: number
  /** The deepest level of nested control flow. */
  readonly nesting: number
  readonly lines: number
  /** Declared parameters, not counting a `self` or `cls` receiver. */
  readonly parameters: number
}

// Longer callee text is usually a chained expression; its last segment says more.
const MAX_CALLEE_TEXT = 40
const LAST_SEGMENT = /[\p{L}\p{N}_$]+$/u
// `self`, `&self`, `&mut self` and `cls` are how a method is called, not something a caller passes.
const RECEIVER_PARAMETER = /\b(self|cls)$/

export function extractShape(grammar: ShapeGrammar, definition: Node): UnitShape {
  const fn = grammar.functionNode(definition)
  const calls = callNames(grammar, fn)
  const bailOuts = calls.list.filter((name) => grammar.errorCalls.has(name)).length
  const parameters = parametersOf(fn)
  const branches = fn.descendantsOfType([...grammar.branchTypes]).length
  return {
    parameters,
    // TypeScript's return type node includes its leading colon.
    returnType: squeeze(fn.childForFieldName("return_type")?.text ?? "").replace(/^:\s*/, "") || null,
    calls: new Set(calls.list),
    errorPaths: fn.descendantsOfType([...grammar.errorTypes]).length + bailOuts,
    branches,
    metrics: {
      complexity: 1 + branches + logicalOperatorCount(grammar, fn),
      nesting: deepestNesting(grammar, fn),
      lines: fn.endPosition.row - fn.startPosition.row + 1,
      parameters: [...parameters.keys()].filter((name) => !RECEIVER_PARAMETER.test(name)).length,
    },
  }
}

function logicalOperatorCount(grammar: ShapeGrammar, fn: Node): number {
  return fn.descendantsOfType([...grammar.logicalTypes]).filter((node) => {
    const operator = node?.childForFieldName("operator")?.text
    return operator !== undefined && grammar.logicalOperators.has(operator)
  }).length
}

function deepestNesting(grammar: ShapeGrammar, fn: Node): number {
  const nestingTypes = new Set(grammar.nestingTypes)
  const depths = fn.descendantsOfType(grammar.nestingTypes.slice()).map((node) => (node === null ? 0 : nestingDepth(node, fn, nestingTypes)))
  return Math.max(0, ...depths)
}

function nestingDepth(node: Node, fn: Node, nestingTypes: ReadonlySet<string>): number {
  let depth = 0
  for (let current: Node | null = node; current !== null && current.id !== fn.id; current = current.parent) {
    // `else if` reads as a sibling of its `if`, though the syntax tree nests it inside the `else`.
    if (nestingTypes.has(current.type) && current.parent?.type !== "else_clause") depth++
  }
  return depth
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
    complexity: before.metrics.complexity === after.metrics.complexity ? null : { before: before.metrics.complexity, after: after.metrics.complexity },
  }
  const hasAny =
    facts.parametersAdded.length + facts.parametersRemoved.length + facts.parametersChanged.length + facts.callsAdded.length + facts.callsRemoved.length > 0 ||
    facts.returnType !== null ||
    facts.complexity !== null ||
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
