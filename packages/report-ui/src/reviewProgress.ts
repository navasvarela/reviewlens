import { changedUnitsOf, isBehaviourChange, UnitChangeKind } from "@lens/review-model"
import type { ChangedFile, ChangedUnit } from "@lens/review-model"
import { isTestPath, isTestUnit } from "./reviewPlan.ts"
import type { ReviewPlan, ReviewStop } from "./reviewPlan.ts"

/**
 * What the reviewer has done so far. Items are identified by what they are rather than by their
 * place on the path, so the path and "All changes" share one record, and a change in the ranking
 * can't move a tick onto a different function.
 */
export interface ReviewState {
  readonly reviewed: ReadonlySet<string>
  readonly comments: ReadonlyMap<string, string>
}

export const EMPTY_REVIEW_STATE: ReviewState = { reviewed: new Set(), comments: new Map() }

export const ItemKind = { NewCode: "newCode", ChangedCode: "changedCode", Test: "test", File: "file" } as const
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind]

/** Something a reviewer can mark as reviewed. */
export interface ReviewItem {
  readonly id: string
  readonly kind: ItemKind
  readonly path: string
  readonly label: string
}

export interface Progress {
  readonly reviewed: number
  readonly total: number
}

export function unitItemId(file: ChangedFile, unit: ChangedUnit): string {
  // Overloads and cfg variants can repeat a name in one file, so its position separates them.
  const sameName = changedUnitsOf(file).filter((other) => other.kind === unit.kind && other.qualifiedName === unit.qualifiedName)
  return `${file.diff.path}\0${unit.kind}\0${unit.qualifiedName}\0${sameName.indexOf(unit)}`
}

function fileItemId(file: ChangedFile): string {
  return `${file.diff.path}\0file`
}

/** The items a file adds to the overall review. Skippable files and formatting edits add none. */
export function itemsOfFile(file: ChangedFile): ReviewItem[] {
  if (file.noise !== null) return []
  const units = changedUnitsOf(file)
  if (units.length === 0) {
    return [{ id: fileItemId(file), kind: isTestPath(file.diff.path) ? ItemKind.Test : ItemKind.File, path: file.diff.path, label: file.diff.path }]
  }
  return units.filter((unit) => isBehaviourChange(unit.change)).map((unit) => ({ id: unitItemId(file, unit), kind: kindOfUnit(file, unit), path: file.diff.path, label: unit.qualifiedName }))
}

function kindOfUnit(file: ChangedFile, unit: ChangedUnit): ItemKind {
  if (isTestPath(file.diff.path) || isTestUnit(unit)) return ItemKind.Test
  return unit.change.kind === UnitChangeKind.Added ? ItemKind.NewCode : ItemKind.ChangedCode
}

/** The items a stop stands for: its function, or everything in a file shown whole. */
export function stopItemIds(stop: ReviewStop): readonly string[] {
  if (stop.unit !== null) return [unitItemId(stop.file, stop.unit)]
  const ids = itemsOfFile(stop.file).map((item) => item.id)
  return ids.length > 0 ? ids : [fileItemId(stop.file)]
}

export function isReviewed(ids: readonly string[], state: ReviewState): boolean {
  return ids.length > 0 && ids.every((id) => state.reviewed.has(id))
}

export function fileProgress(file: ChangedFile, state: ReviewState): Progress {
  const items = itemsOfFile(file)
  return { reviewed: items.filter((item) => state.reviewed.has(item.id)).length, total: items.length }
}

export function overallProgress(files: readonly ChangedFile[], state: ReviewState): Progress {
  return files.map((file) => fileProgress(file, state)).reduce((sum, progress) => ({ reviewed: sum.reviewed + progress.reviewed, total: sum.total + progress.total }), { reviewed: 0, total: 0 })
}

export function pathProgress(plan: ReviewPlan, state: ReviewState): Progress {
  return { reviewed: plan.stops.filter((stop) => isReviewed(stopItemIds(stop), state)).length, total: plan.stops.length }
}

/** Where to pick up: the first stop not yet reviewed, or undefined when the path is done. */
export function nextUnreviewedStop(plan: ReviewPlan, state: ReviewState): number | undefined {
  const index = plan.stops.findIndex((stop) => !isReviewed(stopItemIds(stop), state))
  return index === -1 ? undefined : index
}

export type RemainingCounts = Readonly<Record<ItemKind, number>>

/** What is still unreviewed and not on the path, so the finish screen reflects all marking. */
export function remainingOffPath(files: readonly ChangedFile[], plan: ReviewPlan, state: ReviewState): RemainingCounts {
  const onPath = new Set(plan.stops.flatMap(stopItemIds))
  const counts: Record<ItemKind, number> = { [ItemKind.NewCode]: 0, [ItemKind.ChangedCode]: 0, [ItemKind.Test]: 0, [ItemKind.File]: 0 }
  for (const item of files.flatMap(itemsOfFile)) {
    if (!onPath.has(item.id) && !state.reviewed.has(item.id)) counts[item.kind]++
  }
  return counts
}

export interface ItemComment {
  readonly item: ReviewItem
  readonly text: string
}

export function commentsOnItems(files: readonly ChangedFile[], state: ReviewState): ItemComment[] {
  return files.flatMap(itemsOfFile).flatMap((item) => {
    const text = state.comments.get(item.id)?.trim()
    return text === undefined || text === "" ? [] : [{ item, text }]
  })
}

/** Ready to paste into the PR, until Lens can post comments itself. */
export function commentsAsMarkdown(comments: readonly ItemComment[]): string {
  return comments.map(({ item, text }) => (item.label === item.path ? `**\`${item.path}\`**\n\n${text}` : `**\`${item.label}\`** in \`${item.path}\`\n\n${text}`)).join("\n\n---\n\n")
}

/** Reads saved state defensively: browser storage can hold anything, or an older format. */
export function parseSavedState(text: string | null): ReviewState {
  if (text === null) return EMPTY_REVIEW_STATE
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== "object" || parsed === null) return EMPTY_REVIEW_STATE
    const reviewed = "reviewed" in parsed && Array.isArray(parsed.reviewed) ? parsed.reviewed.filter((id): id is string => typeof id === "string") : []
    const comments = "comments" in parsed && Array.isArray(parsed.comments) ? parsed.comments.flatMap(commentEntry) : []
    return { reviewed: new Set(reviewed), comments: new Map(comments) }
  } catch {
    return EMPTY_REVIEW_STATE
  }
}

function commentEntry(entry: unknown): [string, string][] {
  if (!Array.isArray(entry)) return []
  const [id, text]: unknown[] = entry
  return typeof id === "string" && typeof text === "string" ? [[id, text]] : []
}

export function serializeState(state: ReviewState): string {
  return JSON.stringify({ reviewed: [...state.reviewed], comments: [...state.comments] })
}

export function withReviewed(state: ReviewState, ids: readonly string[], reviewed: boolean): ReviewState {
  const next = new Set(state.reviewed)
  for (const id of ids) {
    if (reviewed) next.add(id)
    else next.delete(id)
  }
  return { ...state, reviewed: next }
}

export function withComment(state: ReviewState, id: string, text: string): ReviewState {
  const next = new Map(state.comments)
  if (text === "") next.delete(id)
  else next.set(id, text)
  return { ...state, comments: next }
}
