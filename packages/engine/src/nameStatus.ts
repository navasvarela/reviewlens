export const EntryStatus = {
  Added: "added",
  Modified: "modified",
  Deleted: "deleted",
  /** A path that changed kind, e.g. a regular file replaced by a symlink. */
  TypeChanged: "typeChanged",
  Renamed: "renamed",
  Copied: "copied",
} as const

type SinglePathStatus =
  | typeof EntryStatus.Added
  | typeof EntryStatus.Modified
  | typeof EntryStatus.Deleted
  | typeof EntryStatus.TypeChanged

type MovedPathStatus = typeof EntryStatus.Renamed | typeof EntryStatus.Copied

export type NameStatusEntry =
  | { readonly status: SinglePathStatus; readonly path: string }
  | {
      readonly status: MovedPathStatus
      readonly path: string
      readonly previousPath: string
      readonly similarity: number
    }

export class NameStatusParseError extends Error {
  override readonly name = "NameStatusParseError"
}

const SINGLE_PATH_STATUS_BY_CODE: ReadonlyMap<string, SinglePathStatus> = new Map([
  ["A", EntryStatus.Added],
  ["M", EntryStatus.Modified],
  ["D", EntryStatus.Deleted],
  ["T", EntryStatus.TypeChanged],
])

const MOVED_PATH_STATUS_BY_CODE: ReadonlyMap<string, MovedPathStatus> = new Map([
  ["R", EntryStatus.Renamed],
  ["C", EntryStatus.Copied],
])

/**
 * Parses `git diff --name-status -z`. With `-z`, paths are NUL-terminated and never
 * quoted, so any file name round-trips exactly. Each entry is a status field followed
 * by one path, or by source and destination paths for renames and copies, whose status
 * carries the similarity score (`R087`).
 */
export function parseNameStatus(output: string): NameStatusEntry[] {
  const fields = output.split("\0")
  const entries: NameStatusEntry[] = []
  let cursor = 0
  const take = (): string => {
    const field = fields.at(cursor++)
    if (field === undefined || field.length === 0) {
      throw new NameStatusParseError(`Truncated name-status output at field ${cursor}`)
    }
    return field
  }

  // The output ends with a NUL, so the final field is always empty.
  while (cursor < fields.length && fields.at(cursor) !== "") {
    const statusField = take()
    const code = statusField.charAt(0)

    const single = SINGLE_PATH_STATUS_BY_CODE.get(code)
    if (single !== undefined) {
      entries.push({ status: single, path: take() })
      continue
    }

    const moved = MOVED_PATH_STATUS_BY_CODE.get(code)
    if (moved !== undefined) {
      const similarity = parseSimilarity(statusField)
      const previousPath = take()
      entries.push({ status: moved, path: take(), previousPath, similarity })
      continue
    }

    throw new NameStatusParseError(`Unexpected diff status "${statusField}"`)
  }
  return entries
}

function parseSimilarity(statusField: string): number {
  const similarity = Number(statusField.slice(1))
  if (!Number.isInteger(similarity) || similarity < 0 || similarity > 100) {
    throw new NameStatusParseError(`Invalid similarity in diff status "${statusField}"`)
  }
  return similarity
}
