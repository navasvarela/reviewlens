import { basename, matchesGlob } from "node:path"
import { FileChangeStatus } from "@walkdiff/review-model"
import type { CommitSha, FileDiff, TestCoverage } from "@walkdiff/review-model"
import { readBlobs } from "../blobs.ts"
import { coverageFromReports } from "./readCoverage.ts"
import { readZipEntries } from "./readZip.ts"

export interface CoverageArchive {
  readonly name: string
  readonly zip: Buffer
}

// Larger than any report seen in practice, small enough to read into memory.
const MAX_REPORT_BYTES = 64 * 1024 * 1024
const REPORT_FILE_NAME = /^(lcov\.info|.*\.lcov|cobertura.*\.xml|coverage.*\.xml)$/i

/** The names test tools give these reports by default, plus any the repository's config adds. */
function isReportFile(path: string, extraPatterns: readonly string[]): boolean {
  return REPORT_FILE_NAME.test(basename(path)) || extraPatterns.some((pattern) => matchesGlob(path, pattern))
}

/** Reads the reports inside CI's archives, in order, and uses the first that covers this PR. */
export function coverageFromArchives(archives: readonly CoverageArchive[], diffs: readonly FileDiff[], extraPatterns: readonly string[]): TestCoverage | undefined {
  for (const { name, zip } of archives) {
    const reports = readZipEntries(zip, { accept: (entry) => isReportFile(entry, extraPatterns), maxEntryBytes: MAX_REPORT_BYTES })
    const coverage = coverageFromReports(reports, diffs, `the ${name} artifact in CI`)
    if (coverage !== undefined) return coverage
  }
  return undefined
}

/**
 * Reads a report this PR adds or updates, such as one CI commits to a folder. Only changed files
 * count: a report left in the repository describes some older commit, and its line numbers would
 * be applied to the wrong lines.
 */
export async function coverageInPullRequest(repoDir: string, head: CommitSha, diffs: readonly FileDiff[], extraPatterns: readonly string[]): Promise<TestCoverage | undefined> {
  const paths = diffs.filter((diff) => diff.status !== FileChangeStatus.Deleted && isReportFile(diff.path, extraPatterns)).map((diff) => diff.path)
  if (paths.length === 0) return undefined
  const blobs = await readBlobs(repoDir, paths.map((path) => ({ commit: head, path })))
  const reports = paths.flatMap((name, index) => {
    const blob = blobs.at(index)
    return blob === undefined || blob.length > MAX_REPORT_BYTES ? [] : [{ name, text: blob.toString("utf8") }]
  })
  return coverageFromReports(reports, diffs, paths.join(", "))
}
