import { DiffLineKind, FileChangeStatus, FileContentKind } from "@walkdiff/review-model"
import type { CommitSha, FileContent, FileDiff } from "@walkdiff/review-model"
import { ISOLATED_CONFIG_ENV, runGit } from "./git.ts"
import { EntryStatus, parseNameStatus } from "./nameStatus.ts"
import type { NameStatusEntry } from "./nameStatus.ts"
import { parseFileContent, splitPatchByFile } from "./patch.ts"
import type { FileChunk } from "./patch.ts"

// Both commands must run the same diff pipeline so their entries line up one to one.
// The flags also override user config (external diff tools, colour, textconv) that
// would otherwise change the output format.
const COMMON_DIFF_FLAGS: readonly string[] = ["--find-renames", "--no-ext-diff", "--no-textconv", "--no-color"]

export class PatchMismatchError extends Error {
  override readonly name = "PatchMismatchError"
}

export async function collectFileDiffs(repoDir: string, from: CommitSha, to: CommitSha): Promise<FileDiff[]> {
  const [nameStatus, patch] = await Promise.all([
    runGit(["diff", ...COMMON_DIFF_FLAGS, "--name-status", "-z", from, to], { cwd: repoDir, env: ISOLATED_CONFIG_ENV }),
    runGit(["diff", ...COMMON_DIFF_FLAGS, "--unified=3", from, to], { cwd: repoDir, env: ISOLATED_CONFIG_ENV }),
  ])
  return pairEntriesWithChunks(parseNameStatus(nameStatus), splitPatchByFile(patch))
}

/**
 * Joins the reliable file list from `--name-status -z` with the hunks from the patch.
 * Pairing by position avoids parsing paths out of patch headers, where git quotes
 * unusual file names. A type change is the one case git prints as two patch sections
 * (the old file deleted, the new one created) for a single name-status entry.
 */
export function pairEntriesWithChunks(entries: readonly NameStatusEntry[], chunks: readonly FileChunk[]): FileDiff[] {
  let cursor = 0
  const files = entries.map((entry) => {
    const sectionCount = entry.status === EntryStatus.TypeChanged ? 2 : 1
    const sections = chunks.slice(cursor, cursor + sectionCount)
    cursor += sectionCount
    if (sections.length !== sectionCount) {
      throw new PatchMismatchError(`The patch ended before the section for ${entry.path}`)
    }
    return toFileDiff(entry, mergeContents(sections.map(parseFileContent)))
  })
  if (cursor !== chunks.length) {
    throw new PatchMismatchError(`The patch has ${chunks.length} file sections but the file list accounts for ${cursor}`)
  }
  return files
}

function mergeContents(contents: readonly FileContent[]): FileContent {
  const hunks = []
  for (const content of contents) {
    if (content.kind === FileContentKind.Binary) {
      return content
    }
    hunks.push(...content.hunks)
  }
  return { kind: FileContentKind.Text, hunks }
}

function toFileDiff(entry: NameStatusEntry, content: FileContent): FileDiff {
  const { additions, deletions } = countChangedLines(content)
  const common = { path: entry.path, additions, deletions, content }
  switch (entry.status) {
    case EntryStatus.Added:
      return { ...common, status: FileChangeStatus.Added }
    case EntryStatus.Deleted:
      return { ...common, status: FileChangeStatus.Deleted }
    case EntryStatus.Modified:
    case EntryStatus.TypeChanged:
      return { ...common, status: FileChangeStatus.Modified }
    case EntryStatus.Renamed:
      return { ...common, status: FileChangeStatus.Renamed, previousPath: entry.previousPath, similarity: entry.similarity }
    case EntryStatus.Copied:
      return { ...common, status: FileChangeStatus.Copied, previousPath: entry.previousPath, similarity: entry.similarity }
  }
}

interface ChangedLineCounts {
  readonly additions: number
  readonly deletions: number
}

function countChangedLines(content: FileContent): ChangedLineCounts {
  if (content.kind === FileContentKind.Binary) {
    return { additions: 0, deletions: 0 }
  }
  let additions = 0
  let deletions = 0
  for (const line of content.hunks.flatMap((hunk) => hunk.lines)) {
    if (line.kind === DiffLineKind.Added) additions++
    if (line.kind === DiffLineKind.Removed) deletions++
  }
  return { additions, deletions }
}
