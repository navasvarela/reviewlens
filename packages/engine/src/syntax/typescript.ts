import { SourceLanguage, UnitKind } from "@lens/review-model"
import type { Node } from "web-tree-sitter"
import { namedDefinition } from "./languageSpec.ts"
import type { ContainerContext, DefinitionHeader, LanguageSpec } from "./languageSpec.ts"

const KIND_BY_NODE_TYPE: ReadonlyMap<string, UnitKind> = new Map([
  ["function_declaration", UnitKind.Function],
  ["generator_function_declaration", UnitKind.Function],
  ["function_signature", UnitKind.Function],
  ["class_declaration", UnitKind.Class],
  ["abstract_class_declaration", UnitKind.Class],
  ["interface_declaration", UnitKind.Interface],
  ["type_alias_declaration", UnitKind.TypeAlias],
  ["enum_declaration", UnitKind.Enum],
  ["internal_module", UnitKind.Module],
  ["method_definition", UnitKind.Method],
  ["abstract_method_signature", UnitKind.Method],
])
const FUNCTION_VALUE_TYPES: ReadonlySet<string> = new Set(["arrow_function", "function_expression", "generator_function"])
const VARIABLE_DECLARATION_TYPES: ReadonlySet<string> = new Set(["lexical_declaration", "variable_declaration"])
// A `const` counts as a unit only at module or namespace level; one inside a callback
// passed to `describe(...)`, say, is part of that call, not a definition of its own.
const MODULE_LEVEL_PARENTS: ReadonlySet<string> = new Set(["program", "export_statement", "statement_block"])
const CONTAINERS: ReadonlySet<UnitKind> = new Set([UnitKind.Class, UnitKind.Module])
// Function bodies and call arguments hold local code, never module-level definitions.
const OPAQUE_NODE_TYPES: ReadonlySet<string> = new Set([
  "call_expression",
  "arrow_function",
  "function_expression",
  "statement_block",
])
const STRING_DELIMITERS: ReadonlySet<string> = new Set(["'", '"'])

function describe(node: Node, container: ContainerContext | undefined): DefinitionHeader | undefined {
  if (node.type === "variable_declarator") {
    return describeVariable(node, container)
  }
  if (node.type === "public_field_definition") {
    // Class fields holding arrow functions are methods in all but syntax.
    const value = node.childForFieldName("value")
    return value !== null && FUNCTION_VALUE_TYPES.has(value.type) ? namedDefinition(node, UnitKind.Method) : undefined
  }
  const kind = KIND_BY_NODE_TYPE.get(node.type)
  return kind === undefined ? undefined : namedDefinition(node, kind)
}

function describeVariable(node: Node, container: ContainerContext | undefined): DefinitionHeader | undefined {
  const declaration = node.parent
  const atModuleLevel =
    declaration !== null &&
    VARIABLE_DECLARATION_TYPES.has(declaration.type) &&
    MODULE_LEVEL_PARENTS.has(declaration.parent?.type ?? "") &&
    (container === undefined || container.kind === UnitKind.Module)
  const nameNode = node.childForFieldName("name")
  // Destructuring declarations (`const { a, b } = ...`) have no single name to track.
  if (!atModuleLevel || nameNode === null || nameNode.type !== "identifier") {
    return undefined
  }
  const value = node.childForFieldName("value")
  const kind = value !== null && FUNCTION_VALUE_TYPES.has(value.type) ? UnitKind.Function : UnitKind.Constant
  return { kind, name: nameNode.text, nameNode }
}

function outerNode(node: Node): Node {
  let outer = node
  const parent = node.parent
  if (node.type === "variable_declarator" && parent !== null && declaresOnlyOneName(parent)) {
    outer = parent
  }
  return outer.parent?.type === "export_statement" ? outer.parent : outer
}

function declaresOnlyOneName(declaration: Node): boolean {
  return declaration.namedChildren.filter((child) => child?.type === "variable_declarator").length === 1
}

function makeSpec(language: SourceLanguage, grammar: string): LanguageSpec {
  return {
    language,
    grammar,
    separator: ".",
    describe,
    outerNode,
    isAttachedPrefix: (node) => node.type === "decorator",
    isContainer: (kind) => CONTAINERS.has(kind),
    // A namespace body is a statement_block too, so it stays transparent.
    isOpaque: (node) => OPAQUE_NODE_TYPES.has(node.type) && node.parent?.type !== "internal_module",
    childPrefix: (_header, _node, qualifiedName) => qualifiedName,
    // Prettier and linters flip quote styles wholesale; 'a' and "a" are the same string.
    normalizeLeaf: (leaf) => (STRING_DELIMITERS.has(leaf.type) && leaf.parent?.type === "string" ? '"' : leaf.text),
  }
}

export const typescriptSpec = makeSpec(SourceLanguage.TypeScript, "tree-sitter-typescript/tree-sitter-typescript.wasm")
export const tsxSpec = makeSpec(SourceLanguage.Tsx, "tree-sitter-typescript/tree-sitter-tsx.wasm")
