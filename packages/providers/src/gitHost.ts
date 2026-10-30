import type { PullRequest } from "@lens/review-model"

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
}

export interface HostTokens {
  readonly github: string | undefined
  readonly gitlab: string | undefined
}
