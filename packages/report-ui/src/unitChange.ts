import { ModificationWeight, SyntaxAnalysisStatus, UnitChangeKind } from "@lens/review-model"
import type { ChangedFile, ChangedUnit, UnitChange } from "@lens/review-model"

export const Tone = { Added: "added", Removed: "removed", Modified: "modified", Quiet: "quiet" } as const
export type Tone = (typeof Tone)[keyof typeof Tone]

export interface ChangeLabel {
  readonly text: string
  readonly tone: Tone
}

export function changeLabel(change: UnitChange): ChangeLabel {
  switch (change.kind) {
    case UnitChangeKind.Added:
      return { text: "Added", tone: Tone.Added }
    case UnitChangeKind.Removed:
      return { text: "Removed", tone: Tone.Removed }
    case UnitChangeKind.Modified:
      return modificationLabel(change.weight)
    case UnitChangeKind.Renamed:
      return { text: `Renamed from ${change.previousName}`, tone: Tone.Quiet }
    case UnitChangeKind.MovedIn:
      return { text: `Moved from ${change.from.path}`, tone: Tone.Quiet }
    case UnitChangeKind.MovedOut:
      return { text: `Moved to ${change.to.path}`, tone: Tone.Quiet }
  }
}

function modificationLabel(weight: ModificationWeight): ChangeLabel {
  switch (weight) {
    case ModificationWeight.Semantic:
      return { text: "Modified", tone: Tone.Modified }
    case ModificationWeight.CommentsOnly:
      return { text: "Comments only", tone: Tone.Quiet }
    case ModificationWeight.FormattingOnly:
      return { text: "Formatting only", tone: Tone.Quiet }
  }
}

/** Changes that leave behaviour as it was: shown collapsed so attention goes elsewhere. */
export function isQuiet(unit: ChangedUnit): boolean {
  return changeLabel(unit.change).tone === Tone.Quiet
}

export function unitsOf(file: ChangedFile): readonly ChangedUnit[] {
  return file.syntax.status === SyntaxAnalysisStatus.Analyzed ? file.syntax.units : []
}

export interface FileSummary {
  readonly needsAttention: number
  readonly quiet: number
}

export function summarizeFile(file: ChangedFile): FileSummary {
  const units = unitsOf(file)
  const quiet = units.filter(isQuiet).length
  return { needsAttention: units.length - quiet, quiet }
}
