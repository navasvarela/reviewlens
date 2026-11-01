import { join } from "node:path"
import { analyzeChangedFiles, createAiProvider, fetchCommits, readCoverage, readWalkdiffConfig, reviewWithAi } from "@walkdiff/engine"
import { displayName, gitHostFor, parsePullRequestUrl, repositoryPath } from "@walkdiff/providers"
import type { HostTokens, PullRequestRef } from "@walkdiff/providers"
import { AiReviewStatus, REVIEW_MODEL_SCHEMA_VERSION, reviewModelSchema } from "@walkdiff/review-model"
import type { AiReview, CheckId, ReviewModel } from "@walkdiff/review-model"
import type { AiOptions, ReviewOptions } from "./args.ts"
import { detectPullRequestUrl } from "./ciEnvironment.ts"
import type { CiEnvironment } from "./ciEnvironment.ts"
import { writeReport } from "./report.ts"
import { serveReport } from "./server.ts"
import type { ReportServer } from "./server.ts"

// One above the app's 4317, so the two can run together.
const PREFERRED_REPORT_PORT = 4318
const ANY_FREE_PORT = 0

const SHORT_SHA_LENGTH = 10

export interface AnalysisDependencies {
  readonly tokens: HostTokens
  readonly cacheDir: string
  readonly now: () => Date
  readonly log: (message: string) => void
}

export interface ReviewDependencies extends AnalysisDependencies {
  readonly env: CiEnvironment
}

/** What an analysis needs to know, whichever command asked for it. */
export interface AnalysisRequest {
  readonly network: boolean
  readonly coveragePath: string | undefined
  readonly ai: AiOptions | undefined
  readonly disabledChecks?: readonly CheckId[]
}

export async function runReview(options: ReviewOptions, deps: ReviewDependencies): Promise<void> {
  const ref = parsePullRequestUrl(options.url ?? (await detectPullRequestUrl(deps.env)))
  const model = await analyzePullRequest(ref, options, deps)
  const reportDir = options.outDir ?? defaultReportDir(deps.cacheDir, ref)
  await writeReport(model, reportDir)

  deps.log(`${model.files.length} files changed, security level ${model.risk.securityLevel}. Report written to ${reportDir}`)
  if (!options.serve) {
    return
  }
  const server = await serveReportOnPreferredPort(reportDir, options.port)
  deps.log(`Serving the report at ${server.url} (Ctrl+C to stop)`)
}

/**
 * Prefers a fixed port because browsers keep saved data per origin, including the port: a new
 * port on every run would lose the reviewer's progress and comments.
 */
async function serveReportOnPreferredPort(reportDir: string, port: number | undefined): Promise<ReportServer> {
  if (port !== undefined) return serveReport(reportDir, port)
  try {
    return await serveReport(reportDir, PREFERRED_REPORT_PORT)
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") return serveReport(reportDir, ANY_FREE_PORT)
    throw error
  }
}

export async function analyzePullRequest(ref: PullRequestRef, options: AnalysisRequest, deps: AnalysisDependencies): Promise<ReviewModel> {
  deps.log(`Fetching ${displayName(ref)}…`)
  const snapshot = await gitHostFor(ref, deps.tokens).fetchPullRequest()
  const { pullRequest } = snapshot

  deps.log(`Fetching commits ${shortSha(pullRequest.mergeBaseSha)}..${shortSha(pullRequest.headSha)}…`)
  const repoDir = await fetchCommits({
    cacheDir: deps.cacheDir,
    cloneUrl: snapshot.cloneUrl,
    credentials: snapshot.gitAuth,
    commits: [pullRequest.mergeBaseSha, pullRequest.headSha],
  })

  deps.log("Analyzing changes…")
  const { files, risk } = await analyzeChangedFiles(repoDir, pullRequest.mergeBaseSha, pullRequest.headSha, {
    network: options.network,
    disabledChecks: options.disabledChecks ?? [],
  })
  const testCoverage = options.coveragePath === undefined ? null : await readCoverage(options.coveragePath, files.map((file) => file.diff))
  const ai: AiReview =
    options.ai === undefined
      ? { status: AiReviewStatus.Disabled }
      : await reviewWithAi({
          repoDir,
          base: pullRequest.mergeBaseSha,
          head: pullRequest.headSha,
          context: { pullRequest, files, risk },
          provider: createAiProvider(options.ai, process.env),
          cacheDir: deps.cacheDir,
          maxInputTokens: options.ai.maxInputTokens,
        })
  deps.log(describeAiReview(ai))
  // Validating our own output catches engine bugs here rather than as a broken report.
  return reviewModelSchema.parse({
    schemaVersion: REVIEW_MODEL_SCHEMA_VERSION,
    generatedAt: deps.now().toISOString(),
    pullRequest,
    files,
    risk,
    ai,
    testCoverage,
    feedbackUrl: (await readWalkdiffConfig(repoDir, pullRequest.mergeBaseSha)).feedback.url,
  })
}

function describeAiReview(ai: AiReview): string {
  switch (ai.status) {
    case AiReviewStatus.Disabled:
      return "AI review off (pass --ai to enable)."
    case AiReviewStatus.Unavailable:
      return `AI review not available: ${ai.reason}.`
    case AiReviewStatus.Completed: {
      const cost = ai.estimatedCostUsd === null ? "" : `, about $${ai.estimatedCostUsd.toFixed(2)}`
      const source = ai.cached ? "from cache" : `${ai.usage.inputTokens} input and ${ai.usage.outputTokens} output tokens${cost}`
      return `AI review by ${ai.model}: ${ai.chapters.length} chapters, ${ai.questions.length} questions, ${ai.droppedStatements} uncited statements dropped (${source}).`
    }
  }
}

export function defaultReportDir(cacheDir: string, ref: PullRequestRef): string {
  return join(cacheDir, "reports", new URL(ref.webOrigin).host, repositoryPath(ref), String(ref.number))
}

function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH)
}
