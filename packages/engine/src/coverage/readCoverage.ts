import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { DiffLineKind, FileContentKind } from "@walkdiff/review-model"
import type { FileDiff, TestCoverage } from "@walkdiff/review-model"

export class CoverageFileError extends Error {
  override readonly name = "CoverageFileError"
}

/** Line number to times it ran, per path as the coverage tool wrote it. */
type LineHits = Map<string, Map<number, number>>

const COBERTURA_ROOT = /<coverage[\s>]/
const LCOV_RECORD = /^SF:/m
const COBERTURA_CLASS = /<class\b[^>]*?\bfilename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g
const COBERTURA_LINE = /<line\b[^>]*?\bnumber="(\d+)"[^>]*?\bhits="(\d+)"/g
const XML_ENTITIES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" }

/**
 * Reads a coverage report and keeps only the lines this PR added, which is all a review needs
 * and keeps the rest of a codebase out of the report.
 *
 * @throws {CoverageFileError} When the file can't be read, or isn't LCOV or Cobertura.
 */
export async function readCoverage(path: string, diffs: readonly FileDiff[]): Promise<TestCoverage> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error: unknown) {
    throw new CoverageFileError(`Could not read the coverage file ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return coverageOfAddedLines(parseCoverage(text, path), diffs, basename(path))
}

export interface CoverageReport {
  readonly name: string
  readonly text: string
}

/**
 * Combines reports, as a monorepo or test shards produce several, keeping the lines this PR added.
 * Files that aren't coverage reports are skipped, since a folder also holds other XML. Undefined
 * when nothing mentions a changed file, which says nothing about whether the code ran.
 */
export function coverageFromReports(reports: readonly CoverageReport[], diffs: readonly FileDiff[], source: string): TestCoverage | undefined {
  const merged: LineHits = new Map()
  for (const report of reports) {
    if (!isCoverageText(report.text)) continue
    for (const [path, lines] of parseCoverage(report.text, report.name)) {
      for (const [line, count] of lines) record(merged, path, line, count)
    }
  }
  const coverage = coverageOfAddedLines(merged, diffs, source)
  return coverage.files.length === 0 ? undefined : coverage
}

function isCoverageText(text: string): boolean {
  return COBERTURA_ROOT.test(text) || LCOV_RECORD.test(text)
}

export function parseCoverage(text: string, path: string): LineHits {
  if (COBERTURA_ROOT.test(text)) return parseCobertura(text)
  if (LCOV_RECORD.test(text)) return parseLcov(text)
  throw new CoverageFileError(`${path} isn't a coverage format Walkdiff can read. Use LCOV or Cobertura XML.`)
}

function parseLcov(text: string): LineHits {
  const hits: LineHits = new Map()
  let current: string | undefined
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SF:")) current = line.slice("SF:".length).trim()
    else if (line === "end_of_record") current = undefined
    else if (line.startsWith("DA:") && current !== undefined) {
      const [lineNumber, count] = line.slice("DA:".length).split(",")
      record(hits, current, Number(lineNumber), Number(count))
    }
  }
  return hits
}

function parseCobertura(text: string): LineHits {
  const hits: LineHits = new Map()
  for (const [, filename = "", body = ""] of text.matchAll(COBERTURA_CLASS)) {
    const path = filename.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity)
    for (const [, lineNumber, count] of body.matchAll(COBERTURA_LINE)) record(hits, path, Number(lineNumber), Number(count))
  }
  return hits
}

// One file can appear several times, as with test shards. A line ran if any of them ran it.
function record(hits: LineHits, path: string, line: number, count: number): void {
  if (!Number.isSafeInteger(line) || !Number.isFinite(count)) return
  const lines = hits.get(path) ?? new Map<number, number>()
  lines.set(line, Math.max(lines.get(line) ?? 0, count))
  hits.set(path, lines)
}

export function coverageOfAddedLines(hits: LineHits, diffs: readonly FileDiff[], source: string): TestCoverage {
  const reported = [...hits.keys()]
  const files = diffs.flatMap((diff) => {
    const match = matchingPath(diff.path, reported)
    const lines = match === undefined ? undefined : hits.get(match)
    if (lines === undefined) return []
    const added = addedLineNumbers(diff).filter((line) => lines.has(line))
    return [{ path: diff.path, coveredLines: added.filter((line) => (lines.get(line) ?? 0) > 0), uncoveredLines: added.filter((line) => lines.get(line) === 0) }]
  })
  return { source, files }
}

/**
 * Tools write paths in different ways: absolute from a CI machine, or relative to one package of
 * a monorepo. So paths match on their ending, and only when exactly one does: guessing between
 * `a/src/x.ts` and `b/src/x.ts` would show one file's coverage as another's.
 */
function matchingPath(changedPath: string, reported: readonly string[]): string | undefined {
  const normalized = reported.map((path) => ({ path, clean: path.replaceAll("\\", "/").replace(/^\.\//, "") }))
  const exact = normalized.find(({ clean }) => clean === changedPath)
  if (exact !== undefined) return exact.path
  const suffixes = normalized.filter(({ clean }) => clean.endsWith(`/${changedPath}`) || changedPath.endsWith(`/${clean}`))
  return suffixes.length === 1 ? suffixes.at(0)?.path : undefined
}

function addedLineNumbers(diff: FileDiff): number[] {
  if (diff.content.kind === FileContentKind.Binary) return []
  return diff.content.hunks.flatMap((hunk) => hunk.lines.flatMap((line) => (line.kind === DiffLineKind.Added ? [line.newLine] : [])))
}
