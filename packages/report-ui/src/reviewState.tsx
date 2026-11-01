import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { ReactElement, ReactNode } from "react"
import { EMPTY_REVIEW_STATE, parseSavedState, serializeState, withComment, withReviewed } from "./reviewProgress.ts"
import type { ReviewState } from "./reviewProgress.ts"

const STORAGE_KEY_PREFIX = "walkdiff-review:"

export interface ReviewStateActions {
  readonly state: ReviewState
  readonly setReviewed: (ids: readonly string[], reviewed: boolean) => void
  readonly setComment: (id: string, text: string) => void
}

const ReviewStateContext = createContext<ReviewStateActions>({ state: EMPTY_REVIEW_STATE, setReviewed: () => undefined, setComment: () => undefined })

export function useReviewState(): ReviewStateActions {
  return useContext(ReviewStateContext)
}

interface ReviewStateProviderProps {
  readonly headSha: string
  readonly children: ReactNode
}

/**
 * Keeps progress and comments in this browser, by commit, so a new push starts afresh until
 * "Changes since my last review" can carry ticks across. Storage can be unavailable, as in a
 * private window or some reports opened from disk: the review then lasts until the page closes.
 */
export function ReviewStateProvider({ headSha, children }: ReviewStateProviderProps): ReactElement {
  const key = `${STORAGE_KEY_PREFIX}${headSha}`
  const [state, setState] = useState(() => parseSavedState(readStorage(key)))
  const update = useCallback(
    (change: (current: ReviewState) => ReviewState): void => {
      setState((current) => {
        const next = change(current)
        writeStorage(key, serializeState(next))
        return next
      })
    },
    [key],
  )
  const value = useMemo(
    () => ({
      state,
      setReviewed: (ids: readonly string[], reviewed: boolean): void => update((current) => withReviewed(current, ids, reviewed)),
      setComment: (id: string, text: string): void => update((current) => withComment(current, id, text)),
    }),
    [state, update],
  )
  return <ReviewStateContext.Provider value={value}>{children}</ReviewStateContext.Provider>
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Progress is a convenience: without storage it lasts until the page closes.
  }
}
