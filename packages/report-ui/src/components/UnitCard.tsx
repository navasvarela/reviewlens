import type { ReactElement } from "react"
import { UnitChangeKind, UnitKind } from "@lens/review-model"
import type { ChangedUnit, PullRequest, UnitChange, UnitSnapshot } from "@lens/review-model"
import { changeLabel, isQuiet, Tone, untouchedReferenceCount } from "../unitChange.ts"
import { SideBySide, SinglePane } from "./CodeViews.tsx"
import { ImpactPanel } from "./ImpactPanel.tsx"

const KIND_LABELS: Readonly<Record<UnitKind, string>> = {
  [UnitKind.Function]: "fn",
  [UnitKind.Method]: "method",
  [UnitKind.Class]: "class",
  [UnitKind.Struct]: "struct",
  [UnitKind.Enum]: "enum",
  [UnitKind.Trait]: "trait",
  [UnitKind.Impl]: "impl",
  [UnitKind.Interface]: "interface",
  [UnitKind.TypeAlias]: "type",
  [UnitKind.Constant]: "const",
  [UnitKind.Macro]: "macro",
  [UnitKind.Module]: "module",
  [UnitKind.ModuleScope]: "imports & top level",
}

interface UnitCardProps {
  readonly unit: ChangedUnit
  readonly pullRequest: PullRequest
}

export function UnitCard({ unit, pullRequest }: UnitCardProps): ReactElement {
  const label = changeLabel(unit.change)
  const untouchedCallers = untouchedReferenceCount(unit.impact)
  return (
    <details className={`unit unit-${label.tone}`} open={!isQuiet(unit)}>
      <summary>
        <span className="unit-kind">{KIND_LABELS[unit.kind]}</span>
        {unit.kind !== UnitKind.ModuleScope && <code className="unit-name">{unit.qualifiedName}</code>}
        {untouchedCallers > 0 && (
          <span className="impact-badge" title="Places that use this unit but were not changed by this PR">
            {untouchedCallers} untouched {untouchedCallers === 1 ? "caller" : "callers"}
          </span>
        )}
        <span className={`change-label tone-${label.tone}`}>{label.text}</span>
      </summary>
      <UnitBody unit={unit} />
      {unit.impact !== null && <ImpactPanel unit={unit} impact={unit.impact} pullRequest={pullRequest} />}
    </details>
  )
}

interface UnitBodyProps {
  readonly unit: ChangedUnit
}

function UnitBody({ unit }: UnitBodyProps): ReactElement {
  const { change } = unit
  // Collapsed nested units break the link between row and file line number.
  const numbered = !snapshotsOf(change).some((snapshot) => snapshot.elidesNestedUnits)
  switch (change.kind) {
    case UnitChangeKind.Added:
      return <SinglePane snapshot={change.after} tone={Tone.Added} numbered={numbered} />
    case UnitChangeKind.Removed:
      return <SinglePane snapshot={change.before} tone={Tone.Removed} numbered={numbered} />
    case UnitChangeKind.MovedOut:
      return (
        <p className="unit-note">
          Now <code>{change.to.qualifiedName}</code> in <code>{change.to.path}</code>, unchanged apart from formatting and comments.
        </p>
      )
    case UnitChangeKind.Modified:
    case UnitChangeKind.Renamed:
    case UnitChangeKind.MovedIn:
      return <SideBySide before={change.before} after={change.after} numbered={numbered} />
  }
}

function snapshotsOf(change: UnitChange): UnitSnapshot[] {
  return [..."before" in change ? [change.before] : [], ..."after" in change ? [change.after] : []]
}
