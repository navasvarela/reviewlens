import { FileChangeStatus, FileContentKind, SyntaxAnalysisStatus } from "@lens/review-model"
import type { ChangedFile, ChangedUnit, CommitSha, FileDiff, FileNoise, SyntaxAnalysis } from "@lens/review-model"
import { readBlobs } from "./blobs.ts"
import type { BlobRequest } from "./blobs.ts"
import { collectFileDiffs } from "./changedFiles.ts"
import { classifyNoise, isNoiseByPath } from "./noise.ts"
import { compareUnits } from "./syntax/compareUnits.ts"
import type { FileVersions } from "./syntax/compareUnits.ts"
import { extractUnits } from "./syntax/definitions.ts"
import type { FileUnits } from "./syntax/definitions.ts"
import type { LanguageSpec } from "./syntax/languageSpec.ts"
import { languageSpecFor } from "./syntax/languages.ts"
import { withSyntaxTree } from "./syntax/parser.ts"

// Hand-written source files are far below this; files above it are almost always
// generated or data, and parsing them would dominate the run time.
const MAX_PARSED_FILE_BYTES = 1_000_000
const NUL = 0

interface FileText {
  readonly before: string | undefined
  readonly after: string | undefined
}

type SyntaxPlan =
  | { readonly kind: "analyze"; readonly before: LanguageSpec | undefined; readonly after: LanguageSpec | undefined; readonly language: LanguageSpec }
  | { readonly kind: "settled"; readonly analysis: SyntaxAnalysis }

/** Diffs the two commits and runs every analysis layer over the changed files. */
export async function analyzeChangedFiles(repoDir: string, from: CommitSha, to: CommitSha): Promise<ChangedFile[]> {
  const diffs = await collectFileDiffs(repoDir, from, to)
  const texts = await readFileTexts(repoDir, from, to, diffs)
  const noise = diffs.map((diff, index) => classifyNoise(diff.path, textAt(texts, index).after ?? textAt(texts, index).before))
  const plans = diffs.map((diff, index) => planSyntaxAnalysis(diff, textAt(texts, index), noise.at(index) ?? null))

  const versions = await Promise.all(
    diffs.map((diff, index) => extractVersions(diff, textAt(texts, index), plans.at(index))),
  )
  const unitsByPath = compareUnits(versions.filter((version): version is FileVersions => version !== undefined))

  return diffs.map((diff, index) => ({
    diff,
    noise: noise.at(index) ?? null,
    syntax: syntaxAnalysis(plans.at(index), unitsByPath.get(diff.path) ?? []),
  }))
}

function planSyntaxAnalysis(diff: FileDiff, text: FileText, noise: FileNoise | null): SyntaxPlan {
  const after = diff.status === FileChangeStatus.Deleted ? undefined : languageSpecFor(diff.path)
  const before = diff.status === FileChangeStatus.Added ? undefined : languageSpecFor(previousPathOf(diff))
  const language = after ?? before
  if (language === undefined) {
    return { kind: "settled", analysis: { status: SyntaxAnalysisStatus.UnsupportedLanguage } }
  }
  const skipReason = reasonToSkip(diff, text, noise)
  if (skipReason !== undefined) {
    return { kind: "settled", analysis: { status: SyntaxAnalysisStatus.Skipped, reason: skipReason } }
  }
  return { kind: "analyze", before, after, language }
}

function reasonToSkip(diff: FileDiff, text: FileText, noise: FileNoise | null): string | undefined {
  if (noise !== null) return `${noise.kind} file`
  if (diff.content.kind === FileContentKind.Binary) return "binary file"
  // With one side missing, every unit would look added or removed.
  const beforeMissing = diff.status !== FileChangeStatus.Added && text.before === undefined
  const afterMissing = diff.status !== FileChangeStatus.Deleted && text.after === undefined
  if (beforeMissing || afterMissing) return "contents are not text or exceed 1 MB"
  return undefined
}

async function extractVersions(diff: FileDiff, text: FileText, plan: SyntaxPlan | undefined): Promise<FileVersions | undefined> {
  if (plan?.kind !== "analyze") {
    return undefined
  }
  return {
    path: diff.path,
    before: await parseUnits(plan.before, text.before),
    after: await parseUnits(plan.after, text.after),
  }
}

function parseUnits(spec: LanguageSpec | undefined, source: string | undefined): Promise<FileUnits | undefined> {
  if (spec === undefined || source === undefined) {
    return Promise.resolve(undefined)
  }
  return withSyntaxTree(spec, source, (tree) => extractUnits(spec, tree, source))
}

function syntaxAnalysis(plan: SyntaxPlan | undefined, units: ChangedUnit[]): SyntaxAnalysis {
  if (plan === undefined) {
    return { status: SyntaxAnalysisStatus.Skipped, reason: "not analyzed" }
  }
  return plan.kind === "settled" ? plan.analysis : { status: SyntaxAnalysisStatus.Analyzed, language: plan.language.language, units }
}

/**
 * Reads both versions of every file that might be analyzed or checked for generated
 * markers. Lockfiles, vendored and binary files are left out: they are classified by
 * path or diff alone and can be very large.
 */
async function readFileTexts(repoDir: string, from: CommitSha, to: CommitSha, diffs: readonly FileDiff[]): Promise<FileText[]> {
  const requests: BlobRequest[] = []
  const request = (commit: CommitSha, path: string): number => requests.push({ commit, path }) - 1
  const slots = diffs.map((diff) => {
    if (diff.content.kind === FileContentKind.Binary || isNoiseByPath(diff.path)) {
      return { before: undefined, after: undefined }
    }
    return {
      before: diff.status === FileChangeStatus.Added ? undefined : request(from, previousPathOf(diff)),
      after: diff.status === FileChangeStatus.Deleted ? undefined : request(to, diff.path),
    }
  })
  const blobs = await readBlobs(repoDir, requests)
  const blobAt = (slot: number | undefined): Buffer | undefined => (slot === undefined ? undefined : blobs.at(slot))
  return slots.map((slot) => ({ before: decodeText(blobAt(slot.before)), after: decodeText(blobAt(slot.after)) }))
}

function decodeText(blob: Buffer | undefined): string | undefined {
  if (blob === undefined || blob.length > MAX_PARSED_FILE_BYTES || blob.includes(NUL)) {
    return undefined
  }
  return blob.toString("utf8")
}

function previousPathOf(diff: FileDiff): string {
  return diff.status === FileChangeStatus.Renamed || diff.status === FileChangeStatus.Copied ? diff.previousPath : diff.path
}

function textAt(texts: readonly FileText[], index: number): FileText {
  return texts.at(index) ?? { before: undefined, after: undefined }
}
