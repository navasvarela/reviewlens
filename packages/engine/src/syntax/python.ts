import { SourceLanguage, UnitKind } from "@lens/review-model"
import type { Node } from "web-tree-sitter"
import { namedDefinition } from "./languageSpec.ts"
import type { ContainerContext, DefinitionHeader, LanguageSpec } from "./languageSpec.ts"

const CONTAINERS: ReadonlySet<UnitKind> = new Set([UnitKind.Class])

export const pythonSpec: LanguageSpec = {
  language: SourceLanguage.Python,
  grammar: "tree-sitter-python/tree-sitter-python.wasm",
  separator: ".",

  describe(node: Node, container: ContainerContext | undefined): DefinitionHeader | undefined {
    switch (node.type) {
      case "function_definition":
        return namedDefinition(node, container?.kind === UnitKind.Class ? UnitKind.Method : UnitKind.Function)
      case "class_definition":
        return namedDefinition(node, UnitKind.Class)
      default:
        return undefined
    }
  },

  // Decorators live inside a decorated_definition wrapping the function or class.
  outerNode: (node) => (node.parent?.type === "decorated_definition" ? node.parent : node),
  isAttachedPrefix: () => false,
  isContainer: (kind) => CONTAINERS.has(kind),
  isOpaque: (node) => node.type === "call" || node.type === "lambda",
  childPrefix: (_header, _node, qualifiedName) => qualifiedName,
  normalizeLeaf: (leaf) => leaf.text,
}
