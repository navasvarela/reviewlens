import type { KeyboardEvent, ReactElement } from "react"
import { neighbourTab } from "../tabs.ts"
import type { ReportTab, TabSummary } from "../tabs.ts"

export function tabPanelId(tab: ReportTab): string {
  return `panel-${tab}`
}

export function tabButtonId(tab: ReportTab): string {
  return `tab-${tab}`
}

interface ReportTabsProps {
  readonly tabs: readonly TabSummary[]
  readonly selected: ReportTab
  readonly onSelect: (tab: ReportTab) => void
}

/** Follows the ARIA tabs pattern: arrow keys move between tabs, Tab moves into the panel. */
export function ReportTabs({ tabs, selected, onSelect }: ReportTabsProps): ReactElement {
  const moveWithArrows = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
    event.preventDefault()
    const next = neighbourTab(selected, event.key === "ArrowRight" ? 1 : -1)
    onSelect(next)
    document.getElementById(tabButtonId(next))?.focus()
  }
  return (
    <div className="report-tabs" role="tablist" aria-label="Report sections" onKeyDown={moveWithArrows}>
      {tabs.map(({ tab, label, count, tone }) => (
        <button
          key={tab}
          id={tabButtonId(tab)}
          type="button"
          role="tab"
          className="report-tab"
          aria-selected={tab === selected}
          aria-controls={tabPanelId(tab)}
          tabIndex={tab === selected ? 0 : -1}
          onClick={() => onSelect(tab)}
        >
          {label}
          {count !== undefined && <span className={tone === undefined ? "tab-count" : `tab-count severity-${tone}`}>{count}</span>}
        </button>
      ))}
    </div>
  )
}
