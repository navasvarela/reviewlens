import { useEffect } from "react"
import type { ReactElement } from "react"
import { changedUnitsOf, UnitChangeKind, UnitImpactStatus, untouchedReferences } from "@walkdiff/review-model"
import type { ChangedFile, ChangedUnit, PullRequest, UnitImpact, UnitRef } from "@walkdiff/review-model"
import { UNIT_KIND_LABELS } from "../unitChange.ts"
import { ImpactPanel } from "./ImpactPanel.tsx"

interface ImpactEntry {
  readonly path: string
  readonly unit: ChangedUnit
  readonly impact: UnitImpact
}

interface ImpactViewProps {
  readonly files: readonly ChangedFile[]
  /** The unit to scroll to, when arriving from its card. */
  readonly focus: UnitRef | undefined
  readonly pullRequest: PullRequest
  readonly onOpenFile: (path: string) => void
}

/** Where the rest of the code depends on what changed, most exposed units first. */
export function ImpactView({ files, focus, pullRequest, onOpenFile }: ImpactViewProps): ReactElement {
  const entries = impactEntries(files)
  const focusIndex = focus === undefined ? -1 : entries.findIndex((entry) => entry.path === focus.path && entry.unit.qualifiedName === focus.qualifiedName)

  useEffect(() => {
    if (focusIndex !== -1) document.getElementById(anchorId(focusIndex))?.scrollIntoView({ block: "start" })
  }, [focusIndex])

  if (entries.length === 0) {
    return <p className="notice">Nothing else in the repository uses the code this PR changed, as far as a search by name can tell.</p>
  }
  return (
    <section className="impact-view">
      <p className="tab-intro">Found by name and syntax, not type resolution, so check "possible" references yourself.</p>
      {entries.map((entry, index) => (
        <article key={`${entry.path}:${entry.unit.qualifiedName}:${index}`} id={anchorId(index)} className="impact-entry">
          <h2 className="impact-entry-title">
            <span className="unit-kind">{UNIT_KIND_LABELS[entry.unit.kind]}</span>
            <button type="button" className="link-button" onClick={() => onOpenFile(entry.path)}>
              {entry.unit.qualifiedName}
            </button>
            <span className="chapter-path">{entry.path}</span>
          </h2>
          <ImpactPanel unit={entry.unit} impact={entry.impact} pullRequest={pullRequest} />
        </article>
      ))}
    </section>
  )
}

function impactEntries(files: readonly ChangedFile[]): ImpactEntry[] {
  const entries = files.flatMap((file) =>
    changedUnitsOf(file).flatMap((unit) => (unit.impact !== null && isWorthListing(unit, unit.impact) ? [{ path: file.diff.path, unit, impact: unit.impact }] : [])),
  )
  return entries.sort((a, b) => untouchedReferences(b.unit).length - untouchedReferences(a.unit).length)
}

// A changed unit with no callers has nothing to show, but "no references left" after a
// removal or rename is the answer a reviewer is looking for.
function isWorthListing(unit: ChangedUnit, impact: UnitImpact): boolean {
  if (impact.status !== UnitImpactStatus.Traced || impact.totalReferences > 0) return true
  return unit.change.kind === UnitChangeKind.Removed || unit.change.kind === UnitChangeKind.Renamed
}

function anchorId(index: number): string {
  return `impact-${index}`
}
