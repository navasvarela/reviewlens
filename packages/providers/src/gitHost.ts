import type { Conversation, PullRequest, SubmitResult, SubmitReview } from "@walkdiff/review-model"
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
  /** The review threads and who has approved, as the host has them now. */
  fetchConversation(): Promise<Conversation>
  /** Posts a review with its comments, and resolves to a link to it. */
  submitReview(review: SubmitReview): Promise<SubmitResult>
  replyToThread(threadId: string, body: string): Promise<void>
  setThreadResolved(threadId: string, resolved: boolean): Promise<void>
}

export interface HostTokens {
  readonly github: string | undefined
  readonly gitlab: string | undefined
  readonly trustedOrigins: TrustedOrigins
}
