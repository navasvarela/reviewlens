import type { ReactElement } from "react"
import { UnitKind } from "@lens/review-model"
import type { ChangedUnit, OutlineEntry, UnitCall } from "@lens/review-model"
import { changeLabel, unitAnchorId, UNIT_KIND_LABELS } from "../unitChange.ts"

// A map of one or two changes adds nothing the cards below do not already show.
export const MIN_UNITS_FOR_MAP = 2
const MAX_NAMES_SHOWN = 3

interface FileMapProps {
  readonly units: readonly ChangedUnit[]
  readonly outline: readonly OutlineEntry[]
  readonly calls: readonly UnitCall[]
}

/** The file at a glance: what changed among all its definitions, and how the changes connect. */
export function FileMap({ units, outline, calls }: FileMapProps): ReactElement {
  const indexByName = new Map(units.map((unit, index) => [unit.qualifiedName, index]))
  const inOutline = new Set(outline.map((entry) => entry.qualifiedName))
  const elsewhere = units.filter((unit) => !inOutline.has(unit.qualifiedName))

  return (
    <section className="file-map" aria-label="Map of this file">
      <p className="file-map-note">Changed units in file order. The cards below are in reading order: helpers before the code that calls them.</p>
      <ul className="file-map-rows">
        {elsewhere.map((unit) => (
          <UnitRow key={unit.qualifiedName} unit={unit} index={indexByName.get(unit.qualifiedName) ?? 0} lines={undefined} calls={calls} />
        ))}
        {rowsOf(outline, units, indexByName).map((row) =>
          row.kind === "unchanged" ? (
            <li key={`unchanged-${row.startLine}`} className="file-map-unchanged">
              {row.count} unchanged {row.count === 1 ? "definition" : "definitions"}
            </li>
          ) : (
            <UnitRow key={row.unit.qualifiedName} unit={row.unit} index={row.index} lines={row.lines} calls={calls} />
          ),
        )}
      </ul>
    </section>
  )
}

type MapRow =
  | { readonly kind: "unchanged"; readonly startLine: number; readonly count: number }
  | { readonly kind: "changed"; readonly unit: ChangedUnit; readonly index: number; readonly lines: number }

function rowsOf(outline: readonly OutlineEntry[], units: readonly ChangedUnit[], indexByName: ReadonlyMap<string, number>): MapRow[] {
  const rows: MapRow[] = []
  let run: { startLine: number; count: number } | undefined
  const closeRun = (): void => {
    if (run !== undefined) rows.push({ kind: "unchanged", ...run })
    run = undefined
  }
  for (const entry of outline) {
    const index = indexByName.get(entry.qualifiedName)
    const unit = index === undefined ? undefined : units.at(index)
    if (index === undefined || unit === undefined) {
      run = run === undefined ? { startLine: entry.startLine, count: 1 } : { ...run, count: run.count + 1 }
      continue
    }
    closeRun()
    rows.push({ kind: "changed", unit, index, lines: entry.endLine - entry.startLine + 1 })
  }
  closeRun()
  return rows
}

interface UnitRowProps {
  readonly unit: ChangedUnit
  readonly index: number
  readonly lines: number | undefined
  readonly calls: readonly UnitCall[]
}

function UnitRow({ unit, index, lines, calls }: UnitRowProps): ReactElement {
  const label = changeLabel(unit.change)
  const callees = calls.filter((call) => call.caller === unit.qualifiedName).map((call) => call.callee)
  const callers = calls.filter((call) => call.callee === unit.qualifiedName).map((call) => call.caller)
  return (
    <li className="file-map-row">
      <span className="unit-kind">{UNIT_KIND_LABELS[unit.kind]}</span>
      <button type="button" className="link-button" onClick={() => jumpToUnit(index)}>
        {unit.kind === UnitKind.ModuleScope ? "top of file" : unit.qualifiedName}
      </button>
      <span className={`change-label tone-${label.tone}`}>{label.text}</span>
      {lines !== undefined && <span className="file-map-size">{lines} lines</span>}
      {callees.length > 0 && <span className="file-map-link">calls {namesOf(callees)}</span>}
      {callers.length > 0 && <span className="file-map-link">called by {namesOf(callers)}</span>}
    </li>
  )
}

function namesOf(names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMES_SHOWN).join(", ")
  return names.length > MAX_NAMES_SHOWN ? `${shown} +${names.length - MAX_NAMES_SHOWN}` : shown
}

function jumpToUnit(index: number): void {
  const card = document.getElementById(unitAnchorId(index))
  if (card instanceof HTMLDetailsElement) card.open = true
  card?.scrollIntoView({ behavior: "smooth", block: "start" })
}
