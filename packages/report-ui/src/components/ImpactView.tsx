import { useEffect, useState } from "react"
import type { ReactElement } from "react"
import { changedUnitsOf, UnitChangeKind, UnitImpactStatus, untouchedReferences } from "@walkdiff/review-model"
import type { ChangedFile, ChangedUnit, PullRequest, UnitImpact, UnitRef } from "@walkdiff/review-model"
import { impactHeadline } from "../impactHeadline.ts"
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

/**
 * Where the rest of the code depends on what changed, most exposed first. Each change starts
 * collapsed to one headline, because the full lists run to hundreds of lines on a large PR and
 * hide which changes matter.
 */
export function ImpactView({ files, focus, pullRequest, onOpenFile }: ImpactViewProps): ReactElement {
  const entries = impactEntries(files)
  const focusIndex = focus === undefined ? -1 : entries.findIndex((entry) => entry.path === focus.path && entry.unit.qualifiedName === focus.qualifiedName)
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set(focusIndex === -1 ? [] : [focusIndex]))

  useEffect(() => {
    if (focusIndex === -1) return
    setOpen((current) => new Set(current).add(focusIndex))
    document.getElementById(anchorId(focusIndex))?.scrollIntoView({ block: "start" })
  }, [focusIndex])

  if (entries.length === 0) {
    return <p className="notice">Nothing else in the repository uses the code this PR changed, as far as a search by name can tell.</p>
  }
  const untouched = entries.reduce((sum, entry) => sum + untouchedReferences(entry.unit).length, 0)
  const allOpen = open.size === entries.length
  const toggle = (index: number, isOpen: boolean): void => {
    setOpen((current) => {
      const next = new Set(current)
      if (isOpen) next.add(index)
      else next.delete(index)
      return next
    })
  }
  return (
    <section className="impact-view">
      <div className="impact-lead">
        <p className="impact-lead-text">
          <strong>
            {untouched === 0 ? "Nothing this PR didn't change depends on these changes." : `${untouched} ${untouched === 1 ? "place" : "places"} this PR didn't change ${untouched === 1 ? "depends" : "depend"} on ${entries.length} ${entries.length === 1 ? "change" : "changes"}.`}
          </strong>{" "}
          Found by name and syntax, not type resolution, so check "possible" references yourself.
        </p>
        <button type="button" className="link-button" onClick={() => setOpen(allOpen ? new Set() : new Set(entries.keys()))}>
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {entries.map((entry, index) => {
        const headline = impactHeadline(entry.unit, entry.impact)
        return (
          <details
            key={`${entry.path}:${entry.unit.qualifiedName}:${index}`}
            id={anchorId(index)}
            className={`impact-entry impact-tone-${headline.tone}`}
            open={open.has(index)}
            onToggle={(event) => toggle(index, event.currentTarget.open)}
          >
            <summary className="impact-entry-summary">
              <span className="impact-entry-headline">{headline.text}</span>
              <span className="impact-entry-place">
                <span className="unit-kind">{UNIT_KIND_LABELS[entry.unit.kind]}</span> <code>{entry.unit.qualifiedName}</code> <span className="chapter-path">{entry.path}</span>
              </span>
            </summary>
            <div className="impact-entry-body">
              <button type="button" className="link-button" onClick={() => onOpenFile(entry.path)}>
                See this change
              </button>
              <ImpactPanel unit={entry.unit} impact={entry.impact} pullRequest={pullRequest} />
            </div>
          </details>
        )
      })}
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
