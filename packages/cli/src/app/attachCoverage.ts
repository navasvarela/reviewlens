import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { CoverageFileError, coverageFromReports } from "@walkdiff/engine"
import type { CoverageReport } from "@walkdiff/engine"
import { reviewModelSchema, ReviewStatus } from "@walkdiff/review-model"
import type { ReviewSummary } from "@walkdiff/review-model"
import { REVIEW_MODEL_FILE, writeReport } from "../report.ts"
import type { ReviewStore } from "./reviewStore.ts"

/**
 * Applies reviewer-chosen reports to an existing report, without analyzing the PR again: only
 * coverage changes, so a reviewer sees it at once. It is saved with the commit it describes, so
 * a refresh keeps it until the PR gets new commits. Undefined if there is no finished report.
 *
 * @throws {CoverageFileError} When the files don't say anything about what this PR changed.
 */
export async function attachCoverage(store: ReviewStore, id: number, reports: readonly CoverageReport[]): Promise<ReviewSummary | undefined> {
  const reportDir = store.reportDirOf(id)
  if (reportDir === undefined || store.get(id)?.status !== ReviewStatus.Ready) return undefined
  const model = reviewModelSchema.parse(JSON.parse(await readFile(join(reportDir, REVIEW_MODEL_FILE), "utf8")))
  const source = `${reports.map((report) => report.name).join(", ")}, attached by you`
  const coverage = coverageFromReports(reports, model.files.map((file) => file.diff), source)
  if (coverage === undefined) {
    throw new CoverageFileError("Those files don't mention anything this PR changed. Use an LCOV or Cobertura report from the PR's latest commit.")
  }
  await writeReport({ ...model, testCoverage: coverage }, reportDir)
  store.saveAttachedCoverage(id, { headSha: model.pullRequest.headSha, coverage })
  return store.get(id)
}
