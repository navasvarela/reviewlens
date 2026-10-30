import type { SourceLanguage, UnitKind } from "@lens/review-model"
import type { Node } from "web-tree-sitter"

export interface DefinitionHeader {
  readonly kind: UnitKind
  readonly name: string
  /** The identifier naming the definition; rename detection masks it out. */
  readonly nameNode: Node | null
}

/** The unit a definition is nested in, as seen by its children. */
export interface ContainerContext {
  readonly kind: UnitKind
  /** Prefix for children's qualified names, e.g. `<Foo as Display>` for a Rust trait impl. */
  readonly childPrefix: string
}

/**
 * What differs between languages when extracting units. The walker in `definitions.ts`
 * is shared; each language only says which nodes are units and how they are named.
 */
export interface LanguageSpec {
  readonly language: SourceLanguage
  /** Module specifier of the grammar's WASM build, resolved from this package. */
  readonly grammar: string
  /** Joins a container's prefix and a child's name in qualified names. */
  readonly separator: string
  describe(node: Node, container: ContainerContext | undefined): DefinitionHeader | undefined
  /** The outermost node belonging to a definition, such as its `export` or decorator wrapper. */
  outerNode(node: Node): Node
  /** Sibling nodes directly above a definition that belong to it, besides comments: attributes, decorators. */
  isAttachedPrefix(node: Node): boolean
  /** Whether units nested in a unit of this kind are extracted as separate units. */
  isContainer(kind: UnitKind): boolean
  /** Nodes the walker never descends into looking for definitions, such as call arguments. */
  isOpaque(node: Node): boolean
  childPrefix(header: DefinitionHeader, node: Node, qualifiedName: string): string
  /** Rewrites a leaf token whose spelling carries no meaning, e.g. TypeScript quote style. */
  normalizeLeaf(leaf: Node): string
}

export function namedDefinition(node: Node, kind: UnitKind): DefinitionHeader | undefined {
  const nameNode = node.childForFieldName("name")
  return nameNode === null ? undefined : { kind, name: nameNode.text, nameNode }
}
