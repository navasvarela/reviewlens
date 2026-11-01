import { isWhitespace, LineBreaks, scanBlockComment, scanLineComment, scanQuoted, SyntaxKind, words } from "./scanner.ts"
import type { Scanner, Vocabulary } from "./scanner.ts"

export interface JavaScriptDialect {
  readonly vocabulary: Vocabulary
  readonly allowsJsx: boolean
}

const JAVASCRIPT_KEYWORDS =
  "await break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return static super switch this throw try typeof var void while with yield"
const JAVASCRIPT_CONTEXTUAL_KEYWORDS = "as async from get of set"
const CONSTANTS = words("true false null undefined NaN Infinity")
const FUNCTION_DEFINERS = words("function")

const JAVASCRIPT_VOCABULARY: Vocabulary = {
  keywords: words(JAVASCRIPT_KEYWORDS),
  contextualKeywords: words(JAVASCRIPT_CONTEXTUAL_KEYWORDS),
  constants: CONSTANTS,
  types: words(""),
  functionDefiners: FUNCTION_DEFINERS,
}

const TYPESCRIPT_VOCABULARY: Vocabulary = {
  keywords: words(`${JAVASCRIPT_KEYWORDS} enum implements`),
  contextualKeywords: words(
    `${JAVASCRIPT_CONTEXTUAL_KEYWORDS} abstract asserts declare infer interface is keyof module namespace override private protected public readonly satisfies type unique`,
  ),
  constants: CONSTANTS,
  types: words("any bigint boolean never number object string symbol unknown"),
  functionDefiners: FUNCTION_DEFINERS,
}

export const JAVASCRIPT: JavaScriptDialect = { vocabulary: JAVASCRIPT_VOCABULARY, allowsJsx: true }
export const TYPESCRIPT: JavaScriptDialect = { vocabulary: TYPESCRIPT_VOCABULARY, allowsJsx: false }
export const TSX: JavaScriptDialect = { vocabulary: TYPESCRIPT_VOCABULARY, allowsJsx: true }

const FrameKind = { Code: "code", Template: "template", JsxTag: "jsxTag", JsxChildren: "jsxChildren" } as const
type FrameKind = (typeof FrameKind)[keyof typeof FrameKind]

interface Frame {
  kind: FrameKind
  /** Braces opened inside this code frame, so only its own `}` returns to the template or JSX around it. */
  openBraces: number
}

interface LexerState {
  readonly dialect: JavaScriptDialect
  readonly frames: Frame[]
  /** Whether a value can start here, which is what tells `/` from a regex and `<` from a JSX tag. */
  expressionAllowed: boolean
}

const JSX_TAG_NAME = /[\w$.:-]+/y
const JSX_START = /<[A-Za-z_$>]/y
// `<T,>`, `<T extends U>` and `<T>(` start generics, not JSX, even where a value could start.
const GENERIC_START = /<[\w$]+\s*(?:,|extends\b|>\s*\()/y
const DECORATOR = /@[\w$.]+/y
const REGEX_FLAGS = /[a-z]*/y
const PASCAL_CASE_START = /^[A-Z]/
const VALUE_ENDS = ")]}"
/** Division is far more common than a regex this long, and the limit keeps `/[/[/[…` from scanning each line once per slash. */
const MAX_REGEX_LITERAL_CHARS = 500
const VALUE_KEYWORDS = words("this super")

/** Returns a lexer step for one run over a text: template strings and JSX nest, so the step keeps a stack. */
export function createJavaScriptStep(dialect: JavaScriptDialect): (scanner: Scanner) => void {
  const root: Frame = { kind: FrameKind.Code, openBraces: 0 }
  const state: LexerState = { dialect, frames: [root], expressionAllowed: true }
  return (scanner) => {
    const frame = state.frames.at(-1) ?? root
    switch (frame.kind) {
      case FrameKind.Code:
        return scanCode(scanner, state, frame)
      case FrameKind.Template:
        return scanTemplate(scanner, state)
      case FrameKind.JsxTag:
        return scanJsxTag(scanner, state, frame)
      case FrameKind.JsxChildren:
        return scanJsxChildren(scanner, state)
    }
  }
}

function scanCode(scanner: Scanner, state: LexerState, frame: Frame): void {
  const char = scanner.peek()
  if (isWhitespace(char)) scanner.pos++
  else if (scanner.startsWith("//")) scanLineComment(scanner)
  else if (scanner.startsWith("/*")) scanBlockComment(scanner, "/*", "*/")
  else if (char === '"' || char === "'") scanStringValue(scanner, state, char)
  else if (char === "`") openTemplate(scanner, state)
  else if (char === "{") openBrace(scanner, state, frame)
  else if (char === "}") closeBrace(scanner, state, frame)
  else if (!scanValueOrDecorator(scanner, state, char)) scanWordOrPunctuation(scanner, state, char)
}

function scanValueOrDecorator(scanner: Scanner, state: LexerState, char: string): boolean {
  if (char === "/") return state.expressionAllowed && scanRegex(scanner, state)
  if (char === "<") return scanJsxOpening(scanner, state)
  if (char === "@") return scanner.emitMatch(DECORATOR, SyntaxKind.Meta)
  if (!scanner.scanNumber()) return false
  state.expressionAllowed = false
  return true
}

function scanWordOrPunctuation(scanner: Scanner, state: LexerState, char: string): void {
  const word = scanner.scanWord(state.dialect.vocabulary)
  if (word === undefined) {
    state.expressionAllowed = !VALUE_ENDS.includes(char)
    scanner.pos++
    return
  }
  state.expressionAllowed = isKeyword(word, state) && !VALUE_KEYWORDS.has(word)
}

function isKeyword(word: string, state: LexerState): boolean {
  const { vocabulary } = state.dialect
  return vocabulary.keywords.has(word) || vocabulary.contextualKeywords.has(word)
}

function scanStringValue(scanner: Scanner, state: LexerState, quote: string): void {
  scanQuoted(scanner, quote.length, quote, LineBreaks.EndString)
  state.expressionAllowed = false
}

function openTemplate(scanner: Scanner, state: LexerState): void {
  state.frames.push({ kind: FrameKind.Template, openBraces: 0 })
  scanTemplate(scanner, state, scanner.pos + 1)
}

/** Colours template text from the current position, reading from `from` so the opening quote joins the same span. */
function scanTemplate(scanner: Scanner, state: LexerState, from = scanner.pos): void {
  const { text } = scanner
  let index = from
  while (index < text.length) {
    if (text.charAt(index) === "\\") {
      index += 2
    } else if (text.charAt(index) === "`") {
      scanner.emit(SyntaxKind.String, index + 1)
      state.frames.pop()
      state.expressionAllowed = false
      return
    } else if (text.startsWith("${", index)) {
      scanner.emit(SyntaxKind.String, index)
      scanner.pos += 2
      state.frames.push({ kind: FrameKind.Code, openBraces: 0 })
      state.expressionAllowed = true
      return
    } else {
      index++
    }
  }
  scanner.emit(SyntaxKind.String, text.length)
}

function scanRegex(scanner: Scanner, state: LexerState): boolean {
  const end = regexLiteralEnd(scanner)
  if (end === undefined) return false
  REGEX_FLAGS.lastIndex = end
  scanner.emit(SyntaxKind.String, end + (REGEX_FLAGS.exec(scanner.text)?.[0].length ?? 0))
  state.expressionAllowed = false
  return true
}

/** The index after the closing slash, or undefined if this slash doesn't open a regex on this line. */
function regexLiteralEnd(scanner: Scanner): number | undefined {
  const { text } = scanner
  const limit = Math.min(text.length, scanner.pos + MAX_REGEX_LITERAL_CHARS)
  let inCharacterClass = false
  for (let index = scanner.pos + 1; index < limit; index++) {
    const char = text.charAt(index)
    if (char === "\n") return undefined
    if (char === "\\") index++
    else if (char === "[") inCharacterClass = true
    else if (char === "]") inCharacterClass = false
    else if (char === "/" && !inCharacterClass) return index + 1
  }
  return undefined
}

function openBrace(scanner: Scanner, state: LexerState, frame: Frame): void {
  frame.openBraces++
  state.expressionAllowed = true
  scanner.pos++
}

function closeBrace(scanner: Scanner, state: LexerState, frame: Frame): void {
  if (frame.openBraces > 0) frame.openBraces--
  else if (state.frames.length > 1) state.frames.pop()
  state.expressionAllowed = false
  scanner.pos++
}

function scanJsxOpening(scanner: Scanner, state: LexerState): boolean {
  const isOpening = state.dialect.allowsJsx && state.expressionAllowed && scanner.match(JSX_START) !== undefined && scanner.match(GENERIC_START) === undefined
  if (isOpening) openJsx(scanner, state)
  return isOpening
}

function openJsx(scanner: Scanner, state: LexerState): void {
  if (scanner.peek(1) === ">") {
    scanner.pos += 2
    state.frames.push({ kind: FrameKind.JsxChildren, openBraces: 0 })
    return
  }
  scanner.pos++
  scanTagName(scanner)
  state.frames.push({ kind: FrameKind.JsxTag, openBraces: 0 })
}

function scanTagName(scanner: Scanner): void {
  const name = scanner.match(JSX_TAG_NAME)
  if (name === undefined) return
  scanner.emit(PASCAL_CASE_START.test(name) ? SyntaxKind.Type : SyntaxKind.Meta, scanner.pos + name.length)
}

function scanJsxTag(scanner: Scanner, state: LexerState, frame: Frame): void {
  const char = scanner.peek()
  if (scanner.startsWith("/>")) {
    scanner.pos += 2
    leaveJsxElement(state)
  } else if (char === ">") {
    scanner.pos++
    frame.kind = FrameKind.JsxChildren
  } else if (char === '"' || char === "'") {
    scanQuoted(scanner, char.length, char, LineBreaks.Allowed)
  } else if (char === "{") {
    scanner.pos++
    state.frames.push({ kind: FrameKind.Code, openBraces: 0 })
    state.expressionAllowed = true
  } else {
    // Attribute names stay plain: colouring every one makes markup harder to read, not easier.
    scanner.pos += scanner.match(JSX_TAG_NAME)?.length ?? 1
  }
}

/** Text between tags is prose, so nothing in it is a keyword or a string, even "don't" or "for". */
function scanJsxChildren(scanner: Scanner, state: LexerState): void {
  const char = scanner.peek()
  if (char === "{") {
    scanner.pos++
    state.frames.push({ kind: FrameKind.Code, openBraces: 0 })
    state.expressionAllowed = true
  } else if (scanner.startsWith("</")) {
    scanner.pos += 2
    scanTagName(scanner)
    closeJsxTag(scanner, state)
  } else if (char === "<" && scanner.match(JSX_START) !== undefined) {
    openJsx(scanner, state)
  } else {
    scanner.pos++
  }
}

function closeJsxTag(scanner: Scanner, state: LexerState): void {
  while (isWhitespace(scanner.peek())) scanner.pos++
  if (scanner.peek() === ">") scanner.pos++
  leaveJsxElement(state)
}

function leaveJsxElement(state: LexerState): void {
  state.frames.pop()
  state.expressionAllowed = false
}
