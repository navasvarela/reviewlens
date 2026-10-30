import { DatabaseSync } from "node:sqlite"
import { GitHostKind, ReviewStatus, reviewSummarySchema } from "@lens/review-model"
import type { ReviewSummary } from "@lens/review-model"
import { z } from "zod"

/** Each entry moves the database one version forward; `PRAGMA user_version` records how far. */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE reviews (
     id INTEGER PRIMARY KEY,
     url TEXT NOT NULL UNIQUE,
     host TEXT NOT NULL,
     display_name TEXT NOT NULL,
     status TEXT NOT NULL,
     error TEXT,
     report_dir TEXT,
     ai INTEGER NOT NULL,
     title TEXT,
     author TEXT,
     security_level TEXT,
     units_to_review INTEGER,
     untouched_references INTEGER,
     findings INTEGER,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
]

const INTERRUPTED_ERROR = "The app stopped during this analysis. Refresh to run it again."

const reviewRowSchema = z.object({
  id: z.number(),
  url: z.string(),
  host: z.enum(GitHostKind),
  display_name: z.string(),
  status: z.enum(ReviewStatus),
  error: z.string().nullable(),
  report_dir: z.string().nullable(),
  ai: z.number(),
  title: z.string().nullable(),
  author: z.string().nullable(),
  security_level: z.string().nullable(),
  units_to_review: z.number().nullable(),
  untouched_references: z.number().nullable(),
  findings: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export interface NewReview {
  readonly url: string
  readonly host: GitHostKind
  readonly displayName: string
  readonly ai: boolean
}

export interface CompletedAnalysis {
  readonly reportDir: string
  readonly title: string
  readonly author: string
  readonly securityLevel: string
  readonly unitsToReview: number
  readonly untouchedReferences: number
  readonly findings: number
}

/**
 * The local app's list of reviews, in SQLite so it survives restarts. It holds what the
 * host has no place for; comments and approvals stay on the host.
 */
export class ReviewStore {
  readonly #db: DatabaseSync
  readonly #now: () => Date

  constructor(databasePath: string, now: () => Date) {
    this.#db = new DatabaseSync(databasePath)
    this.#now = now
    this.#migrate()
  }

  close(): void {
    this.#db.close()
  }

  list(): ReviewSummary[] {
    return this.#db.prepare("SELECT * FROM reviews ORDER BY created_at DESC, id DESC").all().map(toSummary)
  }

  get(id: number): ReviewSummary | undefined {
    const row = this.#row(id)
    return row === undefined ? undefined : toSummary(row)
  }

  getByUrl(url: string): ReviewSummary | undefined {
    const row: unknown = this.#db.prepare("SELECT * FROM reviews WHERE url = ?").get(url)
    return row === undefined ? undefined : toSummary(row)
  }

  reportDirOf(id: number): string | undefined {
    return this.#parsedRow(id)?.report_dir ?? undefined
  }

  add(review: NewReview): ReviewSummary {
    const now = this.#timestamp()
    const { lastInsertRowid } = this.#db
      .prepare("INSERT INTO reviews (url, host, display_name, status, ai, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(review.url, review.host, review.displayName, ReviewStatus.Queued, review.ai ? 1 : 0, now, now)
    const added = this.get(Number(lastInsertRowid))
    if (added === undefined) throw new Error("The review just added could not be read back")
    return added
  }

  /** Sets a review's status, clearing any earlier error. */
  setStatus(id: number, status: ReviewStatus): void {
    this.#db.prepare("UPDATE reviews SET status = ?, error = NULL, updated_at = ? WHERE id = ?").run(status, this.#timestamp(), id)
  }

  markReady(id: number, analysis: CompletedAnalysis): void {
    this.#db
      .prepare(
        `UPDATE reviews SET status = ?, error = NULL, report_dir = ?, title = ?, author = ?, security_level = ?,
           units_to_review = ?, untouched_references = ?, findings = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        ReviewStatus.Ready,
        analysis.reportDir,
        analysis.title,
        analysis.author,
        analysis.securityLevel,
        analysis.unitsToReview,
        analysis.untouchedReferences,
        analysis.findings,
        this.#timestamp(),
        id,
      )
  }

  markFailed(id: number, error: string): void {
    this.#db.prepare("UPDATE reviews SET status = ?, error = ?, updated_at = ? WHERE id = ?").run(ReviewStatus.Failed, error, this.#timestamp(), id)
  }

  remove(id: number): void {
    this.#db.prepare("DELETE FROM reviews WHERE id = ?").run(id)
  }

  /** Analyses run in memory, so any still unfinished at startup were cut short by a restart. */
  markInterrupted(): void {
    this.#db
      .prepare("UPDATE reviews SET status = ?, error = ?, updated_at = ? WHERE status IN (?, ?)")
      .run(ReviewStatus.Failed, INTERRUPTED_ERROR, this.#timestamp(), ReviewStatus.Queued, ReviewStatus.Analyzing)
  }

  #migrate(): void {
    const version = z.object({ user_version: z.number() }).parse(this.#db.prepare("PRAGMA user_version").get()).user_version
    MIGRATIONS.slice(version).forEach((migration, index) => {
      this.#db.exec(migration)
      // PRAGMA takes no bound parameters; the value is a number computed here.
      this.#db.exec(`PRAGMA user_version = ${version + index + 1}`)
    })
  }

  #row(id: number): unknown {
    return this.#db.prepare("SELECT * FROM reviews WHERE id = ?").get(id)
  }

  #parsedRow(id: number): z.infer<typeof reviewRowSchema> | undefined {
    const row = this.#row(id)
    return row === undefined ? undefined : reviewRowSchema.parse(row)
  }

  #timestamp(): string {
    return this.#now().toISOString()
  }
}

function toSummary(row: unknown): ReviewSummary {
  const parsed = reviewRowSchema.parse(row)
  return reviewSummarySchema.parse({
    id: parsed.id,
    url: parsed.url,
    host: parsed.host,
    displayName: parsed.display_name,
    status: parsed.status,
    error: parsed.error,
    hasReport: parsed.report_dir !== null,
    ai: parsed.ai === 1,
    title: parsed.title,
    author: parsed.author,
    securityLevel: parsed.security_level,
    unitsToReview: parsed.units_to_review,
    untouchedReferences: parsed.untouched_references,
    findings: parsed.findings,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  })
}
