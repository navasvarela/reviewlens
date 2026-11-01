import { LineBreaks, scanLineComment, scanQuoted, SyntaxKind, words } from "./scanner.ts"
import type { Scanner, Vocabulary } from "./scanner.ts"

const VOCABULARY: Vocabulary = {
  keywords: words(
    "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield",
  ),
  contextualKeywords: words("case match type"),
  constants: words("True False None"),
  types: words("bool bytes dict float frozenset int list object set str tuple"),
  functionDefiners: words("def"),
}

const STRING_OPENING = /[rRbBuUfF]{0,2}(?:"""|'''|"|')/y
const QUOTE_PREFIX = /^[^"']*/
const DECORATOR = /@[\w.]+/y
const LONG_QUOTE_LENGTH = 3

export function pythonStep(scanner: Scanner): void {
  if (scanner.peek() === "#") scanLineComment(scanner)
  else if (!scanToken(scanner)) scanner.pos++
}

function scanToken(scanner: Scanner): boolean {
  return scanString(scanner) || scanDecorator(scanner) || scanner.scanNumber() || scanner.scanWord(VOCABULARY) !== undefined
}

function scanString(scanner: Scanner): boolean {
  const opening = scanner.match(STRING_OPENING)
  if (opening === undefined) return false
  const quote = opening.replace(QUOTE_PREFIX, "")
  scanQuoted(scanner, opening.length, quote, quote.length === LONG_QUOTE_LENGTH ? LineBreaks.Allowed : LineBreaks.EndString)
  return true
}

/** `@` also means matrix multiplication, so it only starts a decorator at the start of a line. */
function scanDecorator(scanner: Scanner): boolean {
  return scanner.peek() === "@" && isOnlyIndentBefore(scanner) && scanner.emitMatch(DECORATOR, SyntaxKind.Meta)
}

function isOnlyIndentBefore(scanner: Scanner): boolean {
  let index = scanner.pos - 1
  while (index >= 0 && (scanner.text.charAt(index) === " " || scanner.text.charAt(index) === "\t")) index--
  return index < 0 || scanner.text.charAt(index) === "\n"
}
