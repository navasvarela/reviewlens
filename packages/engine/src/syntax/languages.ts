import { extname } from "node:path"
import type { LanguageSpec } from "./languageSpec.ts"
import { pythonSpec } from "./python.ts"
import { rustSpec } from "./rust.ts"
import { tsxSpec, typescriptSpec } from "./typescript.ts"

// Plain JavaScript goes through the TSX grammar, which accepts JS and JSX syntax.
const SPEC_BY_EXTENSION: ReadonlyMap<string, LanguageSpec> = new Map([
  [".rs", rustSpec],
  [".ts", typescriptSpec],
  [".mts", typescriptSpec],
  [".cts", typescriptSpec],
  [".tsx", tsxSpec],
  [".js", tsxSpec],
  [".mjs", tsxSpec],
  [".cjs", tsxSpec],
  [".jsx", tsxSpec],
  [".py", pythonSpec],
  [".pyi", pythonSpec],
])

export function languageSpecFor(path: string): LanguageSpec | undefined {
  return SPEC_BY_EXTENSION.get(extname(path).toLowerCase())
}
