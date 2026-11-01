import { LineBreaks, scanLineComment, scanQuoted, SyntaxKind, words } from "./scanner.ts"
import type { Scanner, Vocabulary } from "./scanner.ts"

const VOCABULARY: Vocabulary = {
  keywords: words(
    "as async await break const continue crate dyn else enum extern fn for if impl in let loop macro_rules match mod move mut pub ref return self static struct super trait type unsafe use where while yield",
  ),
  contextualKeywords: words(""),
  constants: words("true false"),
  types: words("bool char str i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64"),
  functionDefiners: words("fn"),
}

const RAW_STRING_OPENING = /[bc]?r#*"/y
const STRING_OPENING = /[bc]?"/y
const ATTRIBUTE = /#!?\[[\w:]*/y
const MACRO_CALL = /[A-Za-z_]\w*!(?=[([{])/y
const LIFETIME = /'[A-Za-z_]\w*/y
// Exactly one character: plain, a surrogate pair, or an escape up to '\u{10FFFF}'. Taking more
// would read the start of `<'a, 'b>` as a literal.
const CHAR_LITERAL = /b?'(?:\\u\{[\da-fA-F_]{1,8}\}|\\[^\n]|[\ud800-\udbff][\udc00-\udfff]|[^\\'\n])'/y
const COMMENT_OPEN = "/*"
const COMMENT_CLOSE = "*/"

export function rustStep(scanner: Scanner): void {
  if (scanner.startsWith("//")) scanLineComment(scanner)
  else if (scanner.startsWith(COMMENT_OPEN)) scanNestedComment(scanner)
  else if (!scanToken(scanner)) scanner.pos++
}

function scanToken(scanner: Scanner): boolean {
  return (
    scanRawString(scanner) ||
    scanString(scanner) ||
    scanner.emitMatch(CHAR_LITERAL, SyntaxKind.String) ||
    scanner.emitMatch(LIFETIME, SyntaxKind.Meta) ||
    scanner.emitMatch(ATTRIBUTE, SyntaxKind.Meta) ||
    scanner.emitMatch(MACRO_CALL, SyntaxKind.Function) ||
    scanner.scanNumber() ||
    scanner.scanWord(VOCABULARY) !== undefined
  )
}

/** Rust block comments nest, unlike those of the other languages. */
function scanNestedComment(scanner: Scanner): void {
  const { text } = scanner
  let depth = 1
  let index = scanner.pos + COMMENT_OPEN.length
  while (index < text.length && depth > 0) {
    if (text.startsWith(COMMENT_OPEN, index)) {
      depth++
      index += COMMENT_OPEN.length
    } else if (text.startsWith(COMMENT_CLOSE, index)) {
      depth--
      index += COMMENT_CLOSE.length
    } else {
      index++
    }
  }
  scanner.emit(SyntaxKind.Comment, index)
}

function scanRawString(scanner: Scanner): boolean {
  const opening = scanner.match(RAW_STRING_OPENING)
  if (opening === undefined) return false
  const close = `"${"#".repeat(opening.length - opening.lastIndexOf("r") - 2)}`
  const closing = scanner.text.indexOf(close, scanner.pos + opening.length)
  scanner.emit(SyntaxKind.String, closing === -1 ? scanner.text.length : closing + close.length)
  return true
}

function scanString(scanner: Scanner): boolean {
  const opening = scanner.match(STRING_OPENING)
  if (opening === undefined) return false
  scanQuoted(scanner, opening.length, '"', LineBreaks.Allowed)
  return true
}
