import { codeSpan, SourceLanguage } from "@walkdiff/review-model"
import { ParameterKind } from "../../syntax/languageSpec.ts"
import type { SignatureParameter, UnitShape } from "../../syntax/shape.ts"

export interface SignatureChanges {
  /** Clauses for changes that break any caller using the old form, reading on from the function's name. */
  readonly certain: readonly string[]
  /** Clauses for changes that break only some callers, or that syntax can't judge. */
  readonly possible: readonly string[]
}

const MAX_TYPE_CHARS = 50
const SELF_TYPE = "Self"
const OPTIONAL_MEMBER = /^[\w$]+\?:/
const NO_VALUE_TYPES: ReadonlySet<string> = new Set(["void", "None", "Promise<void>", "any", "unknown"])
// Types a caller's existing argument still fits, by the language's own coercions.
const RUST_COERCIONS: ReadonlyMap<string, string> = new Map([
  ["&String", "&str"],
  ["&Vec<T>", "&[T]"],
  ["&PathBuf", "&Path"],
  ["&OsString", "&OsStr"],
])
const PYTHON_GENERIC_ALIASES: ReadonlyMap<string, string> = new Map([
  ["List", "list"],
  ["Dict", "dict"],
  ["Set", "set"],
  ["Tuple", "tuple"],
  ["Type", "type"],
  ["FrozenSet", "frozenset"],
])
const NOT_AN_ARGUMENT: ReadonlySet<ParameterKind> = new Set([ParameterKind.Rest, ParameterKind.KeywordRest, ParameterKind.Receiver, ParameterKind.KeywordOnlyMarker, ParameterKind.PositionalOnlyMarker])

interface PythonParameter extends SignatureParameter {
  readonly keywordOnly: boolean
  readonly positionalOnly: boolean
}

/** What a function's signature change means for callers, by the rules of its language. */
export function signatureChanges(language: SourceLanguage, before: UnitShape, after: UnitShape): SignatureChanges {
  const parameters = language === SourceLanguage.Python ? pythonParameterChanges(before.signature, after.signature) : positionalParameterChanges(language, before.signature, after.signature)
  const returned = returnTypeChange(language, before.returnType, after.returnType)
  return { certain: parameters.certain, possible: [...parameters.possible, ...(returned === undefined ? [] : [returned])] }
}

function callable(signature: readonly SignatureParameter[]): SignatureParameter[] {
  return signature.filter((parameter) => !NOT_AN_ARGUMENT.has(parameter.kind))
}

function hasKind(signature: readonly SignatureParameter[], kind: ParameterKind): boolean {
  return signature.some((parameter) => parameter.kind === kind)
}

// A destructured parameter is named by its whole pattern, which is no use in a sentence.
function label(parameter: SignatureParameter, position: number): string {
  return /^[\w$]+$/.test(parameter.name) ? parameter.name : `#${position + 1}`
}

/**
 * Rust and TypeScript pass arguments by position, so a parameter's name is private to the function:
 * `f(a: u32)` → `f(b: u32)` breaks no one. Parameters are therefore paired by name first and
 * by position second, so a rename reads as a rename and not as a removal plus an addition.
 */
function positionalParameterChanges(language: SourceLanguage, before: readonly SignatureParameter[], after: readonly SignatureParameter[]): SignatureChanges {
  const certain: string[] = []
  const possible: string[] = []
  const oldParameters = callable(before)
  const newParameters = callable(after)
  const oldNames = new Set(oldParameters.map((parameter) => parameter.name))
  const partnerOf = (parameter: SignatureParameter, position: number): SignatureParameter | undefined => {
    const byName = newParameters.find((candidate) => candidate.name === parameter.name)
    if (byName !== undefined) return byName
    const atPosition = newParameters.at(position)
    return position < newParameters.length && atPosition !== undefined && !oldNames.has(atPosition.name) ? atPosition : undefined
  }

  const paired = new Set<SignatureParameter>()
  oldParameters.forEach((parameter, position) => {
    const partner = partnerOf(parameter, position)
    if (partner === undefined) {
      // A caller who left out an optional parameter is unaffected by its going.
      if (!hasKind(after, ParameterKind.Rest)) (parameter.kind === ParameterKind.Required ? certain : possible).push(`no longer takes ${codeSpan(label(parameter, position))}`)
      return
    }
    paired.add(partner)
    if (parameter.kind === ParameterKind.Optional && partner.kind === ParameterKind.Required) certain.push(`now requires ${codeSpan(label(partner, position))}`)
    if (isIncompatibleArgument(language, parameter.type, partner.type)) possible.push(`changes the type of ${codeSpan(label(partner, position))}${fromTo(parameter.type, partner.type)}`)
  })
  newParameters.forEach((parameter, position) => {
    if (!paired.has(parameter) && parameter.kind === ParameterKind.Required) certain.push(`has a new required parameter ${codeSpan(label(parameter, position))}`)
  })

  const order = reordered(oldParameters, newParameters)
  if (order !== undefined) possible.push(order)
  return { certain, possible }
}

function reordered(before: readonly SignatureParameter[], after: readonly SignatureParameter[]): string | undefined {
  const inBoth = (list: readonly SignatureParameter[], other: readonly SignatureParameter[]): string[] => list.map((parameter) => parameter.name).filter((name) => other.some((parameter) => parameter.name === name))
  const oldOrder = inBoth(before, after)
  const newOrder = inBoth(after, before)
  const moved = newOrder.filter((name, index) => oldOrder.at(index) !== name)
  return moved.length > 0 ? `reorders its parameters ${moved.map(codeSpan).join(", ")}` : undefined
}

function pythonView(signature: readonly SignatureParameter[]): PythonParameter[] {
  const slash = signature.findIndex((parameter) => parameter.kind === ParameterKind.PositionalOnlyMarker)
  const star = signature.findIndex((parameter) => parameter.kind === ParameterKind.KeywordOnlyMarker || parameter.kind === ParameterKind.Rest)
  return signature.flatMap((parameter, index) => (NOT_AN_ARGUMENT.has(parameter.kind) ? [] : [{ ...parameter, keywordOnly: star !== -1 && index > star, positionalOnly: index < slash }]))
}

/**
 * Python callers can pass most parameters by name or by position, so names and order both matter.
 * Annotations don't: nothing enforces them at run time, and modernising them is common.
 */
function pythonParameterChanges(before: readonly SignatureParameter[], after: readonly SignatureParameter[]): SignatureChanges {
  const certain: string[] = []
  const possible: string[] = []
  const oldParameters = pythonView(before)
  const newParameters = pythonView(after)
  const oldNames = new Set(oldParameters.map((parameter) => parameter.name))
  const newNames = new Set(newParameters.map((parameter) => parameter.name))
  const absorbsKeywords = hasKind(after, ParameterKind.KeywordRest)
  const renamedTo = new Map<string, string>()

  oldParameters.forEach((parameter, position) => {
    const replacement = newParameters.at(position)
    if (!newNames.has(parameter.name) && position < newParameters.length && replacement !== undefined && !oldNames.has(replacement.name)) renamedTo.set(replacement.name, parameter.name)
  })
  for (const parameter of oldParameters) {
    const current = newParameters.find((candidate) => candidate.name === parameter.name)
    if (current === undefined) {
      const newName = [...renamedTo].find(([, old]) => old === parameter.name)?.[0]
      if (newName !== undefined) {
        if (!parameter.positionalOnly) possible.push(`renames its parameter ${codeSpan(parameter.name)} to ${codeSpan(newName)}`)
      } else if (absorbsKeywords) possible.push(`no longer names ${codeSpan(parameter.name)}, which now goes to ${codeSpan("**kwargs")}`)
      else (parameter.kind === ParameterKind.Required ? certain : possible).push(`no longer takes ${codeSpan(parameter.name)}`)
      continue
    }
    if (parameter.kind === ParameterKind.Optional && current.kind === ParameterKind.Required) certain.push(`now requires ${codeSpan(parameter.name)}`)
    if (!parameter.keywordOnly && current.keywordOnly) possible.push(`now takes ${codeSpan(parameter.name)} only by keyword`)
    if (!parameter.positionalOnly && current.positionalOnly) possible.push(`now takes ${codeSpan(parameter.name)} only by position`)
  }
  for (const parameter of newParameters) {
    if (!oldNames.has(parameter.name) && !renamedTo.has(parameter.name) && parameter.kind === ParameterKind.Required) certain.push(`has a new required parameter ${codeSpan(parameter.name)}`)
  }
  const positional = (list: readonly PythonParameter[]): PythonParameter[] => list.filter((parameter) => !parameter.keywordOnly)
  const order = reordered(positional(oldParameters), positional(newParameters))
  if (order !== undefined) possible.push(order)
  return { certain, possible }
}

function isIncompatibleArgument(language: SourceLanguage, before: string | null, after: string | null): boolean {
  // Without a declared type on either side there is nothing to compare; TypeScript may infer the same one.
  if (before === null || after === null) return false
  const oldType = normalizeType(before)
  const newType = normalizeType(after)
  if (oldType === newType) return false
  if (language === SourceLanguage.Rust) {
    // `impl AsRef<str>` accepts what the concrete type accepted, or the caller gets a clear compile error.
    return !newType.startsWith("impl") && !coercesTo(oldType, newType)
  }
  return !isSubsetOf(unionMembers(oldType), unionMembers(newType)) && !onlyAddsOptionalMembers(oldType, newType)
}

// Options objects grow all the time, and an existing call still fits one with a new optional member.
function onlyAddsOptionalMembers(before: string, after: string): boolean {
  const oldMembers = objectMembers(before)
  const newMembers = objectMembers(after)
  if (oldMembers === undefined || newMembers === undefined) return false
  return oldMembers.every((member) => newMembers.includes(member)) && newMembers.every((member) => oldMembers.includes(member) || OPTIONAL_MEMBER.test(member))
}

function objectMembers(type: string): string[] | undefined {
  const body = /^\{(.*)\}$/.exec(type)?.[1]
  return body === undefined ? undefined : topLevelSplit(body, ";").flatMap((member) => topLevelSplit(member, ","))
}

/** ` from A to B`, or nothing when shortening would make the two read the same. */
function fromTo(before: string | null, after: string | null): string {
  const from = shorten(before ?? "")
  const to = shorten(after ?? "")
  return from === to ? "" : ` from ${codeSpan(from)} to ${codeSpan(to)}`
}

function coercesTo(before: string, after: string): boolean {
  if (RUST_COERCIONS.get(before) === after) return true
  const vec = /^&Vec<(.+)>$/.exec(before)?.[1]
  return vec !== undefined && after === `&[${vec}]`
}

function returnTypeChange(language: SourceLanguage, before: string | null, after: string | null): string | undefined {
  if (before === null) return undefined
  if (after === null) return language === SourceLanguage.Rust ? `no longer returns ${shorten(before)}` : undefined
  const oldType = normalizeType(before)
  const newType = normalizeType(after)
  // A caller that handled the wider type still handles the narrower one, and one that got nothing has nothing to break.
  // `Self` names the class it appears in, so changing to or from it nearly always restates the same type.
  if (oldType === newType || NO_VALUE_TYPES.has(oldType) || oldType === SELF_TYPE || newType === SELF_TYPE) return undefined
  if (language !== SourceLanguage.Rust && isSubsetOf(unionMembers(newType), unionMembers(oldType))) return undefined
  return `changes its return type${fromTo(before, after)}`
}

function isSubsetOf(members: readonly string[], of: readonly string[]): boolean {
  return members.every((member) => of.includes(member))
}

/** Rewrites a type so spellings of the same type compare equal. Errs towards calling types equal. */
export function normalizeType(type: string): string {
  // Rust lifetimes go first: `'a` looks like an opening quote, and elided ones mean the same.
  const unquoted = type.replace(/\/\*.*?\*\//g, "").replace(/'\w+(?!['\w])\s*,?\s*/g, "").replace(/<>/g, "").replace(/["'`]/g, "")
  // A class made private under the same name is still the class its callers knew.
  const withoutPaths = unquoted.replace(/\b(?:[A-Za-z_]\w*(?:::|\.))+(?=[A-Za-z_])/g, "").replace(/\b_+(?=[A-Z])/g, "")
  const collapsed = withoutPaths.replace(/\s+/g, " ").replace(/\breadonly /g, "").replace(/,\s*([\])>])/g, "$1").trim()
  const arrays = collapsed.replace(/\bArray<([^<>]+)>/g, "$1[]")
  const aliased = arrays.replace(/\b(List|Dict|Set|Tuple|Type|FrozenSet)\[/g, (_, alias: string) => `${PYTHON_GENERIC_ALIASES.get(alias) ?? alias}[`)
  const optional = rewriteGeneric(aliased, "Optional", (inner) => `${inner} | None`)
  const unions = rewriteGeneric(optional, "Union", (inner) => topLevelSplit(inner, ",").join(" | "))
  return unionMembers(unions).sort().join(" | ").replace(/\s*,\s*/g, ", ")
}

/** Replaces each `name[...]` with what `rewrite` makes of its contents; the brackets can nest. */
function rewriteGeneric(type: string, name: string, rewrite: (inner: string) => string): string {
  const start = new RegExp(`\\b${name}\\[`).exec(type)
  if (start === null) return type
  const open = start.index + start[0].length
  let depth = 1
  let close = open
  for (; close < type.length && depth > 0; close++) {
    if (type.charAt(close) === "[") depth++
    if (type.charAt(close) === "]") depth--
  }
  return rewriteGeneric(`${type.slice(0, start.index)}${rewrite(type.slice(open, close - 1))}${type.slice(close)}`, name, rewrite)
}

/** The top-level alternatives of a union type; a type with none is its own only member. */
function unionMembers(type: string): string[] {
  return topLevelSplit(type, "|")
}

function topLevelSplit(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (const char of text) {
    if ("([{<".includes(char)) depth++
    if (")]}>".includes(char)) depth--
    if (char === separator && depth === 0) {
      parts.push(current.trim())
      current = ""
    } else {
      current += char
    }
  }
  return [...parts, current.trim()].filter((part) => part !== "")
}

function shorten(type: string): string {
  return type.length <= MAX_TYPE_CHARS ? type : `${type.slice(0, MAX_TYPE_CHARS)}…`
}
