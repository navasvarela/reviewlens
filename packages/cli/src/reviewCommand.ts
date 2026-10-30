import { join } from "node:path"
import { analyzeChangedFiles, fetchCommits } from "@lens/engine"
import { displayName, gitHostFor, parsePullRequestUrl, repositoryPath } from "@lens/providers"
import type { HostTokens, PullRequestRef } from "@lens/providers"
import { REVIEW_MODEL_SCHEMA_VERSION, reviewModelSchema } from "@lens/review-model"
import type { ReviewModel } from "@lens/review-model"
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
  // Validating our own output catches engine bugs here rather than as a broken report.
  return reviewModelSchema.parse({
    schemaVersion: REVIEW_MODEL_SCHEMA_VERSION,
    generatedAt: deps.now().toISOString(),
    pullRequest,
    files,
    risk,
  })
}

function defaultReportDir(cacheDir: string, ref: PullRequestRef): string {
  return join(cacheDir, "reports", new URL(ref.webOrigin).host, repositoryPath(ref), String(ref.number))
}

function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH)
}
