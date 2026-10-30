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
  /** Leaf node types that can name a unit where it is used: identifiers, field and type names. */
  readonly identifierTypes: ReadonlySet<string>
  /** How an identifier leaf is used; undefined when it declares a name rather than using one. */
  classifyIdentifier(leaf: Node): IdentifierUse | undefined
  /** Receivers that mean "the enclosing class or type", such as `self` and `this`. */
  readonly selfReceivers: ReadonlySet<string>
  /** Nodes that open a function scope, whose parameters and locals can shadow a unit's name. */
  readonly functionScopeTypes: ReadonlySet<string>
  /** Whether an identifier leaf binds a parameter or local variable. */
  isBindingSite(leaf: Node): boolean
  /**
   * Methods the language calls implicitly (constructors, operator hooks). Every class has
   * one of the same name, so searching for callers by name finds only noise.
   */
  isImplicitlyInvoked(methodName: string): boolean
}

export const IdentifierUseKind = {
  /** The last segment of a path through types or modules: `Size::new`, `crate::util::parse`. */
  Path: "path",
  /** Field or method access on a value: `x.parse()`, `self.parse()`, `Parser.parse`. */
  Member: "member",
  /** The name on its own: `parse(input)`, `Size`. */
  Bare: "bare",
} as const

export type IdentifierUse =
  | { readonly kind: typeof IdentifierUseKind.Path; readonly qualifier: string }
  | { readonly kind: typeof IdentifierUseKind.Member; readonly receiver: string }
  | { readonly kind: typeof IdentifierUseKind.Bare }

const BARE_USE: IdentifierUse = { kind: IdentifierUseKind.Bare }

/**
 * Shared shape of `classifyIdentifier`: a member access or path is recognised by its
 * parent node; a leaf that is its parent's `name` field is a declaration.
 */
export interface IdentifierGrammar {
  /** Parent type → [field holding the used name, field holding the receiver or qualifier]. */
  readonly member: ReadonlyMap<string, readonly [string, string]>
  readonly path: ReadonlyMap<string, readonly [string, string]>
  /** Parents whose `name` field is a use, not a declaration (e.g. import specifiers). */
  readonly nameIsUse: ReadonlySet<string>
  /** Parents whose given field is a label, never a reference (e.g. object literal keys). */
  readonly labels: ReadonlyMap<string, string>
  /**
   * Parents where an identifier binds a parameter or local: parent type → the field
   * holding it, or null when any direct identifier child is a binding.
   */
  readonly bindings: ReadonlyMap<string, string | null>
}

export function classifyWithGrammar(leaf: Node, grammar: IdentifierGrammar): IdentifierUse | undefined {
  const parent = leaf.parent
  if (parent === null) {
    return BARE_USE
  }
  const member = grammar.member.get(parent.type)
  if (member !== undefined && isField(parent, member[0], leaf)) {
    return { kind: IdentifierUseKind.Member, receiver: parent.childForFieldName(member[1])?.text ?? "" }
  }
  const path = grammar.path.get(parent.type)
  if (path !== undefined && isField(parent, path[0], leaf)) {
    return { kind: IdentifierUseKind.Path, qualifier: parent.childForFieldName(path[1])?.text ?? "" }
  }
  const label = grammar.labels.get(parent.type)
  if ((label !== undefined && isField(parent, label, leaf)) || isBindingWithGrammar(leaf, grammar)) {
    return undefined
  }
  if (isField(parent, "name", leaf) && !grammar.nameIsUse.has(parent.type)) {
    return undefined
  }
  return BARE_USE
}

export function isBindingWithGrammar(leaf: Node, grammar: IdentifierGrammar): boolean {
  const parent = leaf.parent
  if (parent === null || !grammar.bindings.has(parent.type)) {
    return false
  }
  const field = grammar.bindings.get(parent.type)
  return field === null || field === undefined ? true : isField(parent, field, leaf)
}

function isField(parent: Node, field: string, leaf: Node): boolean {
  return parent.childForFieldName(field)?.id === leaf.id
}

export function namedDefinition(node: Node, kind: UnitKind): DefinitionHeader | undefined {
  const nameNode = node.childForFieldName("name")
  return nameNode === null ? undefined : { kind, name: nameNode.text, nameNode }
}
