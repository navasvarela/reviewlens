import type { Node, Tree } from "web-tree-sitter"
import { IdentifierUseKind } from "../syntax/languageSpec.ts"
import type { IdentifierUse, LanguageSpec } from "../syntax/languageSpec.ts"

export interface IdentifierOccurrence {
  readonly name: string
  readonly line: number
  readonly use: IdentifierUse
}

/**
 * Finds uses of the given names in a parsed file. Only identifier leaves are considered,
 * so mentions inside comments and string literals never count. A bare name bound as a
 * parameter or local variable in an enclosing function refers to that local, not to the
 * unit, and is skipped. Must run inside `withSyntaxTree`.
 */
export function findIdentifierUses(spec: LanguageSpec, tree: Tree, names: ReadonlySet<string>): IdentifierOccurrence[] {
  const leaves = tree.rootNode
    .descendantsOfType([...spec.identifierTypes])
    .filter((leaf): leaf is Node => leaf !== null && names.has(leaf.text))
  const localsByScope = localBindings(spec, leaves)

  const occurrences: IdentifierOccurrence[] = []
  for (const leaf of leaves) {
    const use = spec.classifyIdentifier(leaf)
    if (use === undefined) continue
    if (use.kind === IdentifierUseKind.Bare && isShadowed(spec, leaf, localsByScope)) continue
    occurrences.push({ name: leaf.text, line: leaf.startPosition.row + 1, use })
  }
  return occurrences
}

/** Names bound inside each function scope, keyed by the scope node's id. */
function localBindings(spec: LanguageSpec, leaves: readonly Node[]): Map<number, Set<string>> {
  const localsByScope = new Map<number, Set<string>>()
  for (const leaf of leaves) {
    if (!spec.isBindingSite(leaf)) continue
    const scope = enclosingScopes(spec, leaf).next().value
    if (scope === undefined) continue
    const locals = localsByScope.get(scope.id) ?? new Set<string>()
    locals.add(leaf.text)
    localsByScope.set(scope.id, locals)
  }
  return localsByScope
}

function isShadowed(spec: LanguageSpec, leaf: Node, localsByScope: ReadonlyMap<number, ReadonlySet<string>>): boolean {
  for (const scope of enclosingScopes(spec, leaf)) {
    if (localsByScope.get(scope.id)?.has(leaf.text)) return true
  }
  return false
}

function* enclosingScopes(spec: LanguageSpec, leaf: Node): Generator<Node> {
  for (let ancestor = leaf.parent; ancestor !== null; ancestor = ancestor.parent) {
    if (spec.functionScopeTypes.has(ancestor.type)) yield ancestor
  }
}
