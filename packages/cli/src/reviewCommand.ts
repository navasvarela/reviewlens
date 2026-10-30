import { join } from "node:path"
import { analyzeChangedFiles, AnthropicProvider, fetchCommits, reviewWithAi } from "@lens/engine"
import { displayName, gitHostFor, parsePullRequestUrl, repositoryPath } from "@lens/providers"
import type { HostTokens, PullRequestRef } from "@lens/providers"
import { AiReviewStatus, REVIEW_MODEL_SCHEMA_VERSION, reviewModelSchema } from "@lens/review-model"
import type { AiReview, ReviewModel } from "@lens/review-model"
import type { ReviewOptions } from "./args.ts"
import { writeReport } from "./report.ts"
import { serveReport } from "./server.ts"

const SHORT_SHA_LENGTH = 10

export interface ReviewDependencies {
  readonly tokens: HostTokens
  readonly cacheDir: string
  readonly now: () => Date
  readonly log: (message: string) => void
}

export async function runReview(options: ReviewOptions, deps: ReviewDependencies): Promise<void> {
  const ref = parsePullRequestUrl(options.url)
  const model = await analyzePullRequest(ref, options, deps)
  const reportDir = options.outDir ?? defaultReportDir(deps.cacheDir, ref)
  await writeReport(model, reportDir)

  deps.log(`${model.files.length} files changed, security level ${model.risk.securityLevel}. Report written to ${reportDir}`)
  if (!options.serve) {
    return
  }
  const server = await serveReport(reportDir, options.port)
  deps.log(`Serving the report at ${server.url} (Ctrl+C to stop)`)
}

async function analyzePullRequest(ref: PullRequestRef, options: ReviewOptions, deps: ReviewDependencies): Promise<ReviewModel> {
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
  })
  const ai: AiReview =
    options.ai === undefined
      ? { status: AiReviewStatus.Disabled }
      : await reviewWithAi({
          repoDir,
          head: pullRequest.headSha,
          context: { pullRequest, files, risk },
          provider: new AnthropicProvider(options.ai.model),
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

function defaultReportDir(cacheDir: string, ref: PullRequestRef): string {
  return join(cacheDir, "reports", new URL(ref.webOrigin).host, repositoryPath(ref), String(ref.number))
}

function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH)
}
