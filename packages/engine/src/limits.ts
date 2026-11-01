/**
 * Largest file the engine reads as source. Hand-written source files are far below this;
 * files above it are almost always generated or data, and parsing or scanning them would
 * dominate the run time.
 */
export const MAX_SOURCE_FILE_BYTES = 1_000_000

/** Throwaway change for testing posted reviews; this PR is never merged. */
export function postingCheck(value: number): number {
  const doubled = value * 2
  return doubled + 1
}
