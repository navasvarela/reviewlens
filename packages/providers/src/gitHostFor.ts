import { GitHostKind } from "@lens/review-model"
import type { GitHost, HostTokens } from "./gitHost.ts"
import { GitHubHost } from "./github.ts"
import { GitLabHost } from "./gitlab.ts"
import type { PullRequestRef } from "./pullRequestUrl.ts"

export function gitHostFor(ref: PullRequestRef, tokens: HostTokens): GitHost {
  switch (ref.host) {
    case GitHostKind.GitHub:
      return new GitHubHost(ref, tokens.github)
    case GitHostKind.GitLab:
      return new GitLabHost(ref, tokens.gitlab)
    default:
      return assertNever(ref)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled git host: ${JSON.stringify(value)}`)
}
