import { z } from "zod"

/**
 * The review model is the contract between the analysis engine and every consumer
 * (report UI, CI, future server). Bump the version on any breaking change so a
 * report UI can refuse a model it does not understand instead of misrendering it.
 */
export const REVIEW_MODEL_SCHEMA_VERSION = 2

export const GitHostKind = { GitHub: "github", GitLab: "gitlab" } as const
export type GitHostKind = (typeof GitHostKind)[keyof typeof GitHostKind]

// SHA-1 object names are 40 hex digits; repositories using SHA-256 have 64.
export const commitShaSchema = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
  .brand<"CommitSha">()
export type CommitSha = z.infer<typeof commitShaSchema>

export const pullRequestSchema = z.object({
  host: z.enum(GitHostKind),
  url: z.url(),
  number: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  author: z.string(),
  baseRef: z.string(),
  headRef: z.string(),
  baseSha: commitShaSchema,
  headSha: commitShaSchema,
  /** The diff is always computed from the merge base, matching what GitHub and GitLab show. */
  mergeBaseSha: commitShaSchema,
})
export type PullRequest = z.infer<typeof pullRequestSchema>

const lineNumberSchema = z.number().int().positive()

export const DiffLineKind = { Context: "context", Added: "added", Removed: "removed" } as const
export type DiffLineKind = (typeof DiffLineKind)[keyof typeof DiffLineKind]

export const diffLineSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(DiffLineKind.Context),
    content: z.string(),
    oldLine: lineNumberSchema,
    newLine: lineNumberSchema,
  }),
  z.object({ kind: z.literal(DiffLineKind.Added), content: z.string(), newLine: lineNumberSchema }),
  z.object({ kind: z.literal(DiffLineKind.Removed), content: z.string(), oldLine: lineNumberSchema }),
])
export type DiffLine = z.infer<typeof diffLineSchema>

export const hunkSchema = z.object({
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  /** Text git prints after the closing `@@`, usually the enclosing function signature. */
  section: z.string(),
  lines: z.array(diffLineSchema).readonly(),
})
export type Hunk = z.infer<typeof hunkSchema>

export const FileContentKind = { Text: "text", Binary: "binary" } as const

export const fileContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(FileContentKind.Text), hunks: z.array(hunkSchema).readonly() }),
  z.object({ kind: z.literal(FileContentKind.Binary) }),
])
export type FileContent = z.infer<typeof fileContentSchema>

export const FileChangeStatus = {
  Added: "added",
  Modified: "modified",
  Deleted: "deleted",
  Renamed: "renamed",
  Copied: "copied",
} as const
export type FileChangeStatus = (typeof FileChangeStatus)[keyof typeof FileChangeStatus]

export const SourceLanguage = { Rust: "rust", TypeScript: "typescript", Tsx: "tsx", Python: "python" } as const
export type SourceLanguage = (typeof SourceLanguage)[keyof typeof SourceLanguage]

export const UnitKind = {
  Function: "function",
  Method: "method",
  Class: "class",
  Struct: "struct",
  Enum: "enum",
  Trait: "trait",
  Impl: "impl",
  Interface: "interface",
  TypeAlias: "typeAlias",
  Constant: "constant",
  Macro: "macro",
  Module: "module",
  /** Everything in a file outside its top-level definitions: imports, top-level statements. */
  ModuleScope: "moduleScope",
} as const
export type UnitKind = (typeof UnitKind)[keyof typeof UnitKind]

/** One side of a unit: its full source text and where it sits in the file. */
export const unitSnapshotSchema = z.object({
  startLine: lineNumberSchema,
  endLine: lineNumberSchema,
  text: z.string(),
  /**
   * True when nested units are collapsed to their first line (containers and the module
   * scope), so a reviewer sees only the code the unit itself owns. Line numbers then no
   * longer follow from `startLine`.
   */
  elidesNestedUnits: z.boolean(),
})
export type UnitSnapshot = z.infer<typeof unitSnapshotSchema>

export const UnitChangeKind = {
  Added: "added",
  Removed: "removed",
  Modified: "modified",
  Renamed: "renamed",
  MovedIn: "movedIn",
  MovedOut: "movedOut",
} as const
export type UnitChangeKind = (typeof UnitChangeKind)[keyof typeof UnitChangeKind]

/**
 * How much a modification matters to a reviewer. Formatting and comment-only changes
 * leave the unit's code tokens identical, so the UI can collapse them.
 */
export const ModificationWeight = { Semantic: "semantic", CommentsOnly: "commentsOnly", FormattingOnly: "formattingOnly" } as const
export type ModificationWeight = (typeof ModificationWeight)[keyof typeof ModificationWeight]

const unitLocationSchema = z.object({ path: z.string().min(1), qualifiedName: z.string() })
export type UnitLocation = z.infer<typeof unitLocationSchema>

export const unitChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(UnitChangeKind.Added), after: unitSnapshotSchema }),
  z.object({ kind: z.literal(UnitChangeKind.Removed), before: unitSnapshotSchema }),
  z.object({
    kind: z.literal(UnitChangeKind.Modified),
    weight: z.enum(ModificationWeight),
    before: unitSnapshotSchema,
    after: unitSnapshotSchema,
  }),
  z.object({
    kind: z.literal(UnitChangeKind.Renamed),
    previousName: z.string(),
    before: unitSnapshotSchema,
    after: unitSnapshotSchema,
  }),
  /** The unit arrived unchanged from another file or container; `from` says where it was. */
  z.object({ kind: z.literal(UnitChangeKind.MovedIn), from: unitLocationSchema, before: unitSnapshotSchema, after: unitSnapshotSchema }),
  /** The unit left this file or container unchanged; `to` says where it went. */
  z.object({ kind: z.literal(UnitChangeKind.MovedOut), to: unitLocationSchema, before: unitSnapshotSchema }),
])
export type UnitChange = z.infer<typeof unitChangeSchema>

export const changedUnitSchema = z.object({
  kind: z.enum(UnitKind),
  name: z.string(),
  /** Container path and name, e.g. `SizeFilter::from_str` or `Parser.parse`; unique within the file. */
  qualifiedName: z.string(),
  change: unitChangeSchema,
})
export type ChangedUnit = z.infer<typeof changedUnitSchema>

export const NoiseKind = { Lockfile: "lockfile", Generated: "generated", Vendored: "vendored" } as const
export type NoiseKind = (typeof NoiseKind)[keyof typeof NoiseKind]

/** Files a reviewer can skip, with the evidence for that call. */
export const fileNoiseSchema = z.object({ kind: z.enum(NoiseKind), reason: z.string() })
export type FileNoise = z.infer<typeof fileNoiseSchema>

export const SyntaxAnalysisStatus = {
  Analyzed: "analyzed",
  UnsupportedLanguage: "unsupportedLanguage",
  Skipped: "skipped",
} as const

/** Whether the file's units could be extracted; when not, the UI falls back to hunks. */
export const syntaxAnalysisSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal(SyntaxAnalysisStatus.Analyzed),
    language: z.enum(SourceLanguage),
    units: z.array(changedUnitSchema).readonly(),
  }),
  z.object({ status: z.literal(SyntaxAnalysisStatus.UnsupportedLanguage) }),
  z.object({ status: z.literal(SyntaxAnalysisStatus.Skipped), reason: z.string() }),
])
export type SyntaxAnalysis = z.infer<typeof syntaxAnalysisSchema>

const fileDiffBase = z.object({
  path: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  content: fileContentSchema,
})

const movedFileFields = {
  previousPath: z.string().min(1),
  /** Git's similarity index between the old and new file, 0–100. */
  similarity: z.number().int().min(0).max(100),
}

/** What git reports for one path: its status and hunks. */
export const fileDiffSchema = z.discriminatedUnion("status", [
  fileDiffBase.extend({ status: z.literal(FileChangeStatus.Added) }),
  fileDiffBase.extend({ status: z.literal(FileChangeStatus.Modified) }),
  fileDiffBase.extend({ status: z.literal(FileChangeStatus.Deleted) }),
  fileDiffBase.extend({ status: z.literal(FileChangeStatus.Renamed), ...movedFileFields }),
  fileDiffBase.extend({ status: z.literal(FileChangeStatus.Copied), ...movedFileFields }),
])
export type FileDiff = z.infer<typeof fileDiffSchema>

/**
 * A changed path as git sees it plus one field per analysis layer. Later milestones
 * add layers (blast radius, risk) beside these rather than widening the diff.
 */
export const changedFileSchema = z.object({
  diff: fileDiffSchema,
  noise: fileNoiseSchema.nullable(),
  syntax: syntaxAnalysisSchema,
})
export type ChangedFile = z.infer<typeof changedFileSchema>

export const reviewModelSchema = z.object({
  schemaVersion: z.literal(REVIEW_MODEL_SCHEMA_VERSION),
  generatedAt: z.iso.datetime(),
  pullRequest: pullRequestSchema,
  files: z.array(changedFileSchema).readonly(),
})
export type ReviewModel = z.infer<typeof reviewModelSchema>
