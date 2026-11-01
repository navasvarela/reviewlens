import type { PullRequest } from "@walkdiff/review-model"
import type { MarkedComment } from "./markedComment.ts"
import type { TrustedOrigins } from "./trustedHosts.ts"

/** Credentials for git's HTTP transport, sent as Basic auth. */
export interface GitHttpAuth {
  readonly username: string
  readonly token: string
}

export interface PullRequestSnapshot {
  readonly pullRequest: PullRequest
  readonly cloneUrl: string
  readonly gitAuth: GitHttpAuth | undefined
}

export interface GitHost {
  fetchPullRequest(): Promise<PullRequestSnapshot>
  /** Posts the comment, or replaces the earlier one carrying the same marker. */
  upsertComment(comment: MarkedComment): Promise<void>
}

export interface HostTokens {
  readonly github: string | undefined
  readonly gitlab: string | undefined
  readonly trustedOrigins: TrustedOrigins
}
