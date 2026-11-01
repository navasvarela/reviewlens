import { DiffLineKind, FileContentKind } from "@walkdiff/review-model"
import type { DiffLine, FileContent, Hunk } from "@walkdiff/review-model"

const FILE_HEADER_PREFIX = "diff --git "
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/
const BINARY_MARKERS: readonly string[] = ["Binary files ", "GIT binary patch"]
// Git omits a hunk range's line count when it is exactly one line.
const IMPLICIT_RANGE_LENGTH = 1

/** The lines of one `diff --git` section of a patch, header included. */
export type FileChunk = readonly string[]

/**
 * Splits `git diff` output into one chunk per file section. Inside a hunk every line
 * starts with a space, `+`, `-` or `\`, so a line starting with `diff --git ` can only
 * be a section header.
 */
export function splitPatchByFile(patch: string): FileChunk[] {
  const chunks: string[][] = []
  for (const line of patch.split("\n")) {
    if (line.startsWith(FILE_HEADER_PREFIX)) {
      chunks.push([line])
    } else {
      chunks.at(-1)?.push(line)
    }
  }
  return chunks
}

export function parseFileContent(chunk: FileChunk): FileContent {
  const firstHunk = chunk.findIndex((line) => line.startsWith("@@"))
  const header = firstHunk === -1 ? chunk : chunk.slice(0, firstHunk)
  if (header.some(isBinaryMarker)) {
    return { kind: FileContentKind.Binary }
  }
  return { kind: FileContentKind.Text, hunks: firstHunk === -1 ? [] : parseHunks(chunk.slice(firstHunk)) }
}

interface HunkHeader {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly section: string
}

interface HunkBuilder {
  readonly hunk: HunkHeader
  readonly lines: DiffLine[]
  nextOldLine: number
  nextNewLine: number
}

function parseHunks(lines: readonly string[]): Hunk[] {
  const hunks: HunkBuilder[] = []
  for (const line of lines) {
    const header = parseHunkHeader(line)
    if (header !== undefined) {
      hunks.push({ hunk: header, lines: [], nextOldLine: header.oldStart, nextNewLine: header.newStart })
      continue
    }
    const current = hunks.at(-1)
    if (current !== undefined) {
      appendLine(current, line)
    }
  }
  return hunks.map(({ hunk, lines: hunkLines }) => ({ ...hunk, lines: hunkLines }))
}

function parseHunkHeader(line: string): HunkHeader | undefined {
  const match = HUNK_HEADER.exec(line)
  if (match === null) {
    return undefined
  }
  const [, oldStart, oldLines, newStart, newLines, section] = match
  return {
    oldStart: Number(oldStart),
    oldLines: oldLines === undefined ? IMPLICIT_RANGE_LENGTH : Number(oldLines),
    newStart: Number(newStart),
    newLines: newLines === undefined ? IMPLICIT_RANGE_LENGTH : Number(newLines),
    section: section ?? "",
  }
}

function appendLine(builder: HunkBuilder, line: string): void {
  const content = line.slice(1)
  switch (line.charAt(0)) {
    case " ":
      builder.lines.push({
        kind: DiffLineKind.Context,
        content,
        oldLine: builder.nextOldLine++,
        newLine: builder.nextNewLine++,
      })
      return
    case "+":
      builder.lines.push({ kind: DiffLineKind.Added, content, newLine: builder.nextNewLine++ })
      return
    case "-":
      builder.lines.push({ kind: DiffLineKind.Removed, content, oldLine: builder.nextOldLine++ })
      return
    default:
      // "\ No newline at end of file" and the empty string after the patch's final newline.
      return
  }
}

function isBinaryMarker(line: string): boolean {
  return BINARY_MARKERS.some((marker) => line.startsWith(marker))
}
