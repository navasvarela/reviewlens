import type { ReactElement } from "react"
import { UnitChangeKind, UnitKind, untouchedReferences } from "@lens/review-model"
import type { ChangedUnit, PullRequest, UnitChange, UnitSnapshot } from "@lens/review-model"
import { changeLabel, factPhrases, isQuiet, Tone, unitAnchorId, UNIT_KIND_LABELS } from "../unitChange.ts"
import { SideBySide, SinglePane } from "./CodeViews.tsx"
import { ImpactPanel } from "./ImpactPanel.tsx"

interface UnitCardProps {
  readonly unit: ChangedUnit
  /** Position among the file's cards, which the file map links to. */
  readonly index: number
  readonly pullRequest: PullRequest
}

export function UnitCard({ unit, index, pullRequest }: UnitCardProps): ReactElement {
  const label = changeLabel(unit.change)
  const untouchedCallers = untouchedReferences(unit).length
  return (
    <details id={unitAnchorId(index)} className={`unit unit-${label.tone}`} open={!isQuiet(unit)}>
      <summary>
        <span className="unit-kind">{UNIT_KIND_LABELS[unit.kind]}</span>
        {unit.kind !== UnitKind.ModuleScope && <code className="unit-name">{unit.qualifiedName}</code>}
        {untouchedCallers > 0 && (
          <span className="impact-badge" title="Places that use this unit but were not changed by this PR">
            {untouchedCallers} untouched {untouchedCallers === 1 ? "caller" : "callers"}
          </span>
        )}
        <span className={`change-label tone-${label.tone}`}>{label.text}</span>
      </summary>
      {unit.facts !== null && (
        <ul className="unit-facts" aria-label="What changed">
          {factPhrases(unit.facts).map((phrase) => (
            <li key={phrase}>{phrase}</li>
          ))}
        </ul>
      )}
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
