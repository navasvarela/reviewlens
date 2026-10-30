import { ModificationWeight, UnitChangeKind, UnitKind } from "@lens/review-model"
import type { ComparedUnit, UnitLocation } from "@lens/review-model"
import { MODULE_SCOPE_NAME } from "./definitions.ts"
import type { Definition, FileUnits, ModuleScope } from "./definitions.ts"

/**
 * Below this many code tokens, identical bodies are too common to call a move:
 * every `fn new() -> Self { Self::default() }` would match every other.
 */
const MIN_MOVED_UNIT_TOKENS = 20

export interface FileVersions {
  readonly path: string
  /** Units at the merge base; undefined for an added file. */
  readonly before: FileUnits | undefined
  /** Units at the head; undefined for a deleted file. */
  readonly after: FileUnits | undefined
}

interface Located {
  readonly path: string
  readonly definition: Definition
}

/**
 * Compares unit versions across all files of a change. Outline:
 * 1. Per file, pair definitions by key; a pair whose own tokens differ is "modified".
 * 2. Unpaired definitions become added/removed candidates, topmost only (a new class
 *    is reported once, not once per method).
 * 3. Across candidates, an added/removed pair with the same body under a new name in
 *    the same container is a rename; the same body anywhere else is a move.
 * 4. Remaining candidates are reported as added or removed.
 */
export function compareUnits(files: readonly FileVersions[]): Map<string, ComparedUnit[]> {
  const unitsByPath = new Map<string, ComparedUnit[]>(files.map((file) => [file.path, []]))
  const report = (path: string, unit: ComparedUnit): void => {
    unitsByPath.get(path)?.push(unit)
  }
  const added: Located[] = []
  const removed: Located[] = []

  for (const file of files) {
    const moduleScopeChange = compareModuleScopes(file.before?.moduleScope, file.after?.moduleScope)
    if (moduleScopeChange !== undefined) {
      report(file.path, moduleScopeChange)
    }
    const pairing = pairDefinitions(file)
    pairing.modified.forEach((unit) => report(file.path, unit))
    added.push(...pairing.added.map((definition) => ({ path: file.path, definition })))
    removed.push(...pairing.removed.map((definition) => ({ path: file.path, definition })))
  }

  for (const [from, to] of takeMatches(removed, added, isRename)) {
    report(to.path, {
      ...describe(to.definition),
      change: { kind: UnitChangeKind.Renamed, previousName: from.definition.name, before: from.definition.snapshot, after: to.definition.snapshot },
    })
  }
  for (const [from, to] of takeMatches(removed, added, isMove)) {
    report(from.path, {
      ...describe(from.definition),
      change: { kind: UnitChangeKind.MovedOut, to: locationOf(to), before: from.definition.snapshot },
    })
    report(to.path, {
      ...describe(to.definition),
      change: { kind: UnitChangeKind.MovedIn, from: locationOf(from), before: from.definition.snapshot, after: to.definition.snapshot },
    })
  }
  for (const { path, definition } of added) {
    report(path, { ...describe(definition), change: { kind: UnitChangeKind.Added, after: definition.snapshot } })
  }
  for (const { path, definition } of removed) {
    report(path, { ...describe(definition), change: { kind: UnitChangeKind.Removed, before: definition.snapshot } })
  }

  for (const units of unitsByPath.values()) {
    units.sort(byPositionInFile)
  }
  return unitsByPath
}

interface Pairing {
  readonly modified: ComparedUnit[]
  readonly added: Definition[]
  readonly removed: Definition[]
}

function pairDefinitions(file: FileVersions): Pairing {
  const before = keyed(file.before?.definitions ?? [])
  const after = keyed(file.after?.definitions ?? [])
  const pairing: Pairing = { modified: [], added: [], removed: [] }

  for (const definition of after.values()) {
    const previous = before.get(definition.key)
    if (previous === undefined) {
      if (isTopmostUnpaired(definition, before)) pairing.added.push(definition)
      continue
    }
    const weight = modificationWeight(previous, definition)
    if (weight !== undefined) {
      pairing.modified.push({
        ...describe(definition),
        change: { kind: UnitChangeKind.Modified, weight, before: previous.snapshot, after: definition.snapshot },
      })
    }
  }
  for (const definition of before.values()) {
    if (!after.has(definition.key) && isTopmostUnpaired(definition, after)) {
      pairing.removed.push(definition)
    }
  }
  return pairing
}

// An unpaired definition inside an unpaired parent is covered by reporting the parent.
function isTopmostUnpaired(definition: Definition, otherSide: ReadonlyMap<string, Definition>): boolean {
  return definition.parentKey === undefined || otherSide.has(definition.parentKey)
}

/**
 * Compares what a unit owns, leaving out nested units (they are compared on their own).
 * Whitespace inside a container is not reported: it shifts whenever a member is added.
 */
function modificationWeight(before: Definition, after: Definition): ModificationWeight | undefined {
  if (before.fingerprints.ownFull === after.fingerprints.ownFull) {
    const reformatted = !after.hasChildren && before.snapshot.text !== after.snapshot.text
    return reformatted ? ModificationWeight.FormattingOnly : undefined
  }
  return before.fingerprints.ownCode === after.fingerprints.ownCode ? ModificationWeight.CommentsOnly : ModificationWeight.Semantic
}

function compareModuleScopes(before: ModuleScope | undefined, after: ModuleScope | undefined): ComparedUnit | undefined {
  const unit = { kind: UnitKind.ModuleScope, name: MODULE_SCOPE_NAME, qualifiedName: MODULE_SCOPE_NAME }
  if (before === undefined && after === undefined) {
    return undefined
  }
  if (before === undefined) {
    return after !== undefined && after.hasOwnTokens ? { ...unit, change: { kind: UnitChangeKind.Added, after: after.snapshot } } : undefined
  }
  if (after === undefined) {
    return before.hasOwnTokens ? { ...unit, change: { kind: UnitChangeKind.Removed, before: before.snapshot } } : undefined
  }
  if (before.ownFull === after.ownFull) {
    return undefined
  }
  const weight = before.ownCode === after.ownCode ? ModificationWeight.CommentsOnly : ModificationWeight.Semantic
  return { ...unit, change: { kind: UnitChangeKind.Modified, weight, before: before.snapshot, after: after.snapshot } }
}

function isRename(from: Located, to: Located): boolean {
  return (
    from.path === to.path &&
    from.definition.kind === to.definition.kind &&
    from.definition.parentKey === to.definition.parentKey &&
    from.definition.name !== to.definition.name &&
    from.definition.fingerprints.nameAgnosticCode === to.definition.fingerprints.nameAgnosticCode
  )
}

function isMove(from: Located, to: Located): boolean {
  return (
    from.definition.kind === to.definition.kind &&
    from.definition.codeTokenCount >= MIN_MOVED_UNIT_TOKENS &&
    from.definition.fingerprints.code === to.definition.fingerprints.code
  )
}

/** Pairs elements of `froms` and `tos` one to one, removing each matched pair from both arrays. */
function takeMatches(
  froms: Located[],
  tos: Located[],
  matches: (from: Located, to: Located) => boolean,
): [Located, Located][] {
  const pairs: [Located, Located][] = []
  for (const from of [...froms]) {
    const toIndex = tos.findIndex((to) => matches(from, to))
    const to = tos.at(toIndex)
    if (toIndex === -1 || to === undefined) continue
    tos.splice(toIndex, 1)
    froms.splice(froms.indexOf(from), 1)
    pairs.push([from, to])
  }
  return pairs
}

function keyed(definitions: readonly Definition[]): Map<string, Definition> {
  return new Map(definitions.map((definition) => [definition.key, definition]))
}

interface UnitIdentity {
  readonly kind: UnitKind
  readonly name: string
  readonly qualifiedName: string
}

function describe(definition: Definition): UnitIdentity {
  return { kind: definition.kind, name: definition.name, qualifiedName: definition.qualifiedName }
}

function locationOf(located: Located): UnitLocation {
  return { path: located.path, qualifiedName: located.definition.qualifiedName }
}

// Module scope first, then in reading order of the file each unit now lives in.
function byPositionInFile(a: ComparedUnit, b: ComparedUnit): number {
  return sortPosition(a) - sortPosition(b)
}

function sortPosition(unit: ComparedUnit): number {
  if (unit.kind === UnitKind.ModuleScope) return 0
  return "after" in unit.change ? unit.change.after.startLine : unit.change.before.startLine
}
