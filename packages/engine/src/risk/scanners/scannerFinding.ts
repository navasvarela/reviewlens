import type { RiskCategory, RiskSeverity } from "@walkdiff/review-model"

/** A finding as a scanner reports it, before it is checked against the lines the PR added. */
export interface ScannerFinding {
  readonly ruleId: string
  readonly category: RiskCategory
  readonly severity: RiskSeverity
  readonly title: string
  readonly detail: string
  readonly path: string
  readonly line: number
  readonly endLine: number
  /** False when the line may hold a secret, so it is left out of the report. */
  readonly showLine: boolean
}
