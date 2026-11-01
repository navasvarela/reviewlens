import { createRequire } from "node:module"
import type { SourceLanguage } from "@walkdiff/review-model"
import { Language, Parser } from "web-tree-sitter"
import type { Tree } from "web-tree-sitter"
import type { LanguageSpec } from "./languageSpec.ts"

const require = createRequire(import.meta.url)

let runtimeReady: Promise<void> | undefined
const parsers = new Map<SourceLanguage, Promise<Parser>>()

/**
 * Parses `source` and hands the tree to `use`. Trees live in WASM memory that the
 * JavaScript garbage collector cannot reclaim, so the tree is freed as soon as `use`
 * returns; `use` must copy out everything it needs and keep no node references.
 */
export async function withSyntaxTree<T>(spec: LanguageSpec, source: string, use: (tree: Tree) => T): Promise<T> {
  const parser = await parserFor(spec)
  const tree = parser.parse(source)
  if (tree === null) {
    throw new Error(`tree-sitter could not parse the ${spec.language} source`)
  }
  try {
    return use(tree)
  } finally {
    tree.delete()
  }
}

function parserFor(spec: LanguageSpec): Promise<Parser> {
  const existing = parsers.get(spec.language)
  if (existing !== undefined) {
    return existing
  }
  const created = createParser(spec)
  parsers.set(spec.language, created)
  return created
}

async function createParser(spec: LanguageSpec): Promise<Parser> {
  runtimeReady ??= Parser.init()
  await runtimeReady
  const language = await Language.load(require.resolve(spec.grammar))
  const parser = new Parser()
  parser.setLanguage(language)
  return parser
}
