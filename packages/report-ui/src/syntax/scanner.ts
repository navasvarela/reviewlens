export const SyntaxKind = {
  Comment: "comment",
  String: "string",
  Constant: "constant",
  Keyword: "keyword",
  Type: "type",
  Function: "function",
  Meta: "meta",
} as const
export type SyntaxKind = (typeof SyntaxKind)[keyof typeof SyntaxKind]

export interface SyntaxSpan {
  readonly start: number
  readonly end: number
  readonly kind: SyntaxKind
}

/** Whether a string can run past the end of its line, which limits the damage of a stray quote. */
export const LineBreaks = { EndString: "endString", Allowed: "allowed" } as const
export type LineBreaks = (typeof LineBreaks)[keyof typeof LineBreaks]

/** The words a language gives meaning to. */
export interface Vocabulary {
  readonly keywords: ReadonlySet<string>
  /** Keywords only when a name or value follows, since they are ordinary names elsewhere (`{ type: 1 }`). */
  readonly contextualKeywords: ReadonlySet<string>
  readonly constants: ReadonlySet<string>
  readonly types: ReadonlySet<string>
  /** Keywords whose next word is the name of a function being defined. */
  readonly functionDefiners: ReadonlySet<string>
}

// All patterns here are sticky and have no nested repetition, so each matches in linear time
// and never looks past what it consumes.
const WORD = /[A-Za-z_$\u0080-￿][\w$\u0080-￿]*/y
const NUMBER = /0[xXoObB][\da-fA-F_]+[a-zA-Z\d]*|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?[a-zA-Z\d_]*/y
const FOLLOWED_BY_VALUE = /[ \t]+[\w$"'`{*([]/y
const STARTS_UPPERCASE = /^[A-Z]/
// `MAX_SIZE` is a constant, but a lone capital such as `T` is a type parameter.
const ALL_CAPS = /^[A-Z][A-Z\d_]+$/
const LINE_BREAK = "\n"
const ESCAPE = "\\"
const CALL_OPENER = "("
const MEMBER_ACCESS = "."

export class Scanner {
  readonly text: string
  readonly spans: SyntaxSpan[] = []
  pos = 0
  private lastWord = ""
  private lastWordEnd = -1

  constructor(text: string) {
    this.text = text
  }

  peek(offset = 0): string {
    return this.text.charAt(this.pos + offset)
  }

  startsWith(value: string): boolean {
    return this.text.startsWith(value, this.pos)
  }

  match(pattern: RegExp): string | undefined {
    pattern.lastIndex = this.pos
    return pattern.exec(this.text)?.[0]
  }

  emit(kind: SyntaxKind, end: number): void {
    if (end > this.pos) this.spans.push({ start: this.pos, end, kind })
    this.pos = end
  }

  /** Colours what a sticky pattern matches here, returning whether it matched. */
  emitMatch(pattern: RegExp, kind: SyntaxKind): boolean {
    const matched = this.match(pattern)
    if (matched === undefined) return false
    this.emit(kind, this.pos + matched.length)
    return true
  }

  /** Consumes a word and colours it by what it means, returning it, or returns undefined if none starts here. */
  scanWord(vocabulary: Vocabulary): string | undefined {
    const word = this.match(WORD)
    if (word === undefined) return undefined
    const end = this.pos + word.length
    const kind = this.wordKind(word, end, vocabulary)
    if (kind === undefined) this.pos = end
    else this.emit(kind, end)
    this.lastWord = word
    this.lastWordEnd = end
    return word
  }

  scanNumber(): boolean {
    return this.emitMatch(NUMBER, SyntaxKind.Constant)
  }

  private wordKind(word: string, end: number, vocabulary: Vocabulary): SyntaxKind | undefined {
    const isMember = this.text.charAt(this.pos - 1) === MEMBER_ACCESS
    if (!isMember) {
      if (vocabulary.keywords.has(word)) return SyntaxKind.Keyword
      if (vocabulary.contextualKeywords.has(word) && this.isFollowedByValue(end)) return SyntaxKind.Keyword
      if (vocabulary.constants.has(word)) return SyntaxKind.Constant
      if (vocabulary.types.has(word)) return SyntaxKind.Type
      if (this.followsFunctionDefiner(vocabulary)) return SyntaxKind.Function
    }
    if (STARTS_UPPERCASE.test(word)) return ALL_CAPS.test(word) ? SyntaxKind.Constant : SyntaxKind.Type
    return this.text.charAt(end) === CALL_OPENER ? SyntaxKind.Function : undefined
  }

  private isFollowedByValue(end: number): boolean {
    FOLLOWED_BY_VALUE.lastIndex = end
    return FOLLOWED_BY_VALUE.test(this.text)
  }

  private followsFunctionDefiner(vocabulary: Vocabulary): boolean {
    return vocabulary.functionDefiners.has(this.lastWord) && this.text.slice(this.lastWordEnd, this.pos).trim() === ""
  }
}

export function scanLineComment(scanner: Scanner): void {
  scanner.emit(SyntaxKind.Comment, endOfLine(scanner))
}

export function scanBlockComment(scanner: Scanner, open: string, close: string): void {
  const closing = scanner.text.indexOf(close, scanner.pos + open.length)
  scanner.emit(SyntaxKind.Comment, closing === -1 ? scanner.text.length : closing + close.length)
}

/** Colours a string from here, where `openLength` covers any prefix and the opening quote. */
export function scanQuoted(scanner: Scanner, openLength: number, close: string, lineBreaks: LineBreaks): void {
  const { text } = scanner
  let index = scanner.pos + openLength
  while (index < text.length) {
    if (text.charAt(index) === ESCAPE) index += 2
    else if (text.startsWith(close, index)) return scanner.emit(SyntaxKind.String, index + close.length)
    else if (lineBreaks === LineBreaks.EndString && text.charAt(index) === LINE_BREAK) return scanner.emit(SyntaxKind.String, index)
    else index++
  }
  scanner.emit(SyntaxKind.String, text.length)
}

export function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === LINE_BREAK || char === "\r"
}

/** Builds a word list from a space-separated string, which keeps the long lists readable. */
export function words(list: string): ReadonlySet<string> {
  return new Set(list === "" ? [] : list.split(" "))
}

function endOfLine(scanner: Scanner): number {
  const lineBreak = scanner.text.indexOf(LINE_BREAK, scanner.pos)
  return lineBreak === -1 ? scanner.text.length : lineBreak
}
