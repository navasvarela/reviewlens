import { UnitChangeKind, UnitImpactStatus, untouchedReferences } from "@walkdiff/review-model"
import type { ChangedUnit, UnitImpact } from "@walkdiff/review-model"

export const ImpactTone = { Warning: "warning", Attention: "attention", Quiet: "quiet" } as const
export type ImpactTone = (typeof ImpactTone)[keyof typeof ImpactTone]

export interface ImpactHeadline {
  readonly text: string
  readonly tone: ImpactTone
}

function places(count: number): string {
  return count === 1 ? "1 place" : `${count} places`
}

/** The one thing to know about a change's reach, so a reviewer can decide whether to open it. */
export function impactHeadline(unit: ChangedUnit, impact: UnitImpact): ImpactHeadline {
  if (impact.status === UnitImpactStatus.TooCommon) return { text: "Name too common to trace callers", tone: ImpactTone.Quiet }
  if (impact.status === UnitImpactStatus.Skipped) return { text: "Callers weren't traced", tone: ImpactTone.Quiet }
  const untouched = untouchedReferences(unit).length
  const gone = unit.change.kind === UnitChangeKind.Removed ? "Removed" : unit.change.kind === UnitChangeKind.Renamed ? "Renamed" : undefined
  if (gone !== undefined) {
    if (untouched > 0) return { text: `${gone}, but ${places(untouched)} this PR didn't change still ${untouched === 1 ? "uses" : "use"} the old name`, tone: ImpactTone.Warning }
    if (impact.totalReferences === 0) return { text: `${gone}, and nothing still uses the old name`, tone: ImpactTone.Quiet }
  }
  if (untouched > 0) return { text: `${capitalize(places(untouched))} this PR didn't change ${untouched === 1 ? "uses" : "use"} it`, tone: ImpactTone.Attention }
  return { text: `Used in ${places(impact.totalReferences)}, all updated in this PR`, tone: ImpactTone.Quiet }
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}
