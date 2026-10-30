import { SourceLanguage, UnitKind } from "@lens/review-model"
import type { Node } from "web-tree-sitter"
import { classifyWithGrammar, isBindingWithGrammar, namedDefinition } from "./languageSpec.ts"
import type { ContainerContext, DefinitionHeader, IdentifierGrammar, LanguageSpec } from "./languageSpec.ts"

const KIND_BY_NODE_TYPE: ReadonlyMap<string, UnitKind> = new Map([
  ["struct_item", UnitKind.Struct],
  ["union_item", UnitKind.Struct],
  ["enum_item", UnitKind.Enum],
  ["trait_item", UnitKind.Trait],
  ["type_item", UnitKind.TypeAlias],
  ["const_item", UnitKind.Constant],
  ["static_item", UnitKind.Constant],
  ["macro_definition", UnitKind.Macro],
  ["mod_item", UnitKind.Module],
])
const FUNCTION_NODE_TYPES: ReadonlySet<string> = new Set(["function_item", "function_signature_item"])
const METHOD_CONTAINERS: ReadonlySet<UnitKind> = new Set([UnitKind.Impl, UnitKind.Trait])
const CONTAINERS: ReadonlySet<UnitKind> = new Set([UnitKind.Impl, UnitKind.Trait, UnitKind.Module])

const IDENTIFIER_GRAMMAR: IdentifierGrammar = {
  member: new Map([["field_expression", ["field", "value"]]]),
  path: new Map([
    ["scoped_identifier", ["name", "path"]],
    ["scoped_type_identifier", ["name", "path"]],
  ]),
  nameIsUse: new Set(),
  // `impl Opts {` implements the type rather than depending on its shape.
  labels: new Map([
    ["field_initializer", "field"],
    ["impl_item", "type"],
  ]),
  bindings: new Map([
    ["parameter", "pattern"],
    ["let_declaration", "pattern"],
    ["closure_parameters", null],
    ["for_expression", "pattern"],
  ]),
}

export const rustSpec: LanguageSpec = {
  language: SourceLanguage.Rust,
  grammar: "tree-sitter-rust/tree-sitter-rust.wasm",
  separator: "::",

  describe(node: Node, container: ContainerContext | undefined): DefinitionHeader | undefined {
    if (FUNCTION_NODE_TYPES.has(node.type)) {
      const isMethod = container !== undefined && METHOD_CONTAINERS.has(container.kind)
      return namedDefinition(node, isMethod ? UnitKind.Method : UnitKind.Function)
    }
    if (node.type === "impl_item") {
      return describeImpl(node)
    }
    const kind = KIND_BY_NODE_TYPE.get(node.type)
    return kind === undefined ? undefined : namedDefinition(node, kind)
  },

  outerNode: (node) => node,
  isAttachedPrefix: (node) => node.type === "attribute_item",
  isContainer: (kind) => CONTAINERS.has(kind),
  isOpaque: () => false,

  // Methods read as `Foo::new` or `<Foo as Display>::fmt`, the way rustdoc and
  // compiler errors name them, rather than through the impl block's own name.
  childPrefix(header: DefinitionHeader, node: Node, qualifiedName: string): string {
    if (header.kind !== UnitKind.Impl) {
      return qualifiedName
    }
    const type = node.childForFieldName("type")?.text ?? qualifiedName
    const trait = node.childForFieldName("trait")?.text
    return trait === undefined ? type : `<${type} as ${trait}>`
  },

  normalizeLeaf: (leaf) => leaf.text,
  identifierTypes: new Set(["identifier", "field_identifier", "type_identifier"]),
  classifyIdentifier: (leaf) => classifyWithGrammar(leaf, IDENTIFIER_GRAMMAR),
  selfReceivers: new Set(["self", "Self"]),
  functionScopeTypes: new Set(["function_item", "closure_expression"]),
  isBindingSite: (leaf) => isBindingWithGrammar(leaf, IDENTIFIER_GRAMMAR),
  // Rust calls only `drop` implicitly, and only through the Drop trait.
  isImplicitlyInvoked: (methodName) => methodName === "drop",
}

function describeImpl(node: Node): DefinitionHeader | undefined {
  const type = node.childForFieldName("type")?.text
  if (type === undefined) {
    return undefined
  }
  const trait = node.childForFieldName("trait")?.text
  return { kind: UnitKind.Impl, name: trait === undefined ? `impl ${type}` : `impl ${trait} for ${type}`, nameNode: null }
}
