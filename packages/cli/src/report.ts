import { access, cp, mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { ReviewModel } from "@lens/review-model"

export const REVIEW_MODEL_FILE = "review.json"

// The CLI runs from source, so the UI build sits at a fixed place in the workspace.
const REPORT_UI_DIST = resolve(import.meta.dirname, "../../report-ui/dist")

export class ReportUiMissingError extends Error {
  override readonly name = "ReportUiMissingError"

  constructor() {
    super(`The report UI has not been built (expected ${REPORT_UI_DIST}). Run: pnpm build:ui`)
  }
}

/**
 * Writes a self-contained static report: the prebuilt UI plus the review model it loads.
 * The directory can be opened by the local server or uploaded as a CI artifact as is.
 */
export async function writeReport(model: ReviewModel, reportDir: string): Promise<void> {
  if (!(await isReadable(join(REPORT_UI_DIST, "index.html")))) {
    throw new ReportUiMissingError()
  }
  await mkdir(reportDir, { recursive: true })
  await cp(REPORT_UI_DIST, reportDir, { recursive: true })
  await writeFile(join(reportDir, REVIEW_MODEL_FILE), JSON.stringify(model))
}

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
