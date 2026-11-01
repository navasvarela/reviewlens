import { ModificationWeight, SyntaxAnalysisStatus, UnitChangeKind, UnitImpactStatus } from "./schema.ts"
import type { ChangedFile, ChangedUnit, CheckRun, Reference, UnitChange } from "./schema.ts"

export function changedUnitsOf(file: ChangedFile): readonly ChangedUnit[] {
  return file.syntax.status === SyntaxAnalysisStatus.Analyzed ? file.syntax.units : []
}

/** False for formatting, comments, renames and moves, which leave behaviour as it was. */
export function isBehaviourChange(change: UnitChange): boolean {
  switch (change.kind) {
    case UnitChangeKind.Added:
    case UnitChangeKind.Removed:
      return true
    case UnitChangeKind.Modified:
      return change.weight === ModificationWeight.Semantic
    case UnitChangeKind.Renamed:
    case UnitChangeKind.MovedIn:
    case UnitChangeKind.MovedOut:
      return false
  }
}

/** Places using this unit that the PR did not change. */
export function untouchedReferences(unit: ChangedUnit): readonly Reference[] {
  if (unit.impact?.status !== UnitImpactStatus.Traced) return []
  return unit.impact.references.filter((reference) => !reference.touchedByPullRequest)
}

/** Names the checks in a sentence, so "nothing found" says what looked. */
export function namesOfChecks(checks: readonly CheckRun[]): string {
  const names = checks.map((check) => check.name)
  const last = names.at(-1) ?? ""
  return names.length < 2 ? last : `${names.slice(0, -1).join(", ")} and ${last}`
}
