import { GitHostKind } from "@walkdiff/review-model"
import type { GitHost, HostTokens } from "./gitHost.ts"
import { GitHubHost } from "./github.ts"
import { GitLabHost } from "./gitlab.ts"
import type { PullRequestRef } from "./pullRequestUrl.ts"
import { isTrustedHost, TRUSTED_GITHUB_HOSTS_VARIABLE, TRUSTED_GITLAB_HOSTS_VARIABLE } from "./trustedHosts.ts"

/**
 * The one place a host gets its token, so every request and git fetch follows the same rule.
 * An untrusted host is still read anonymously, which works for public repositories.
 */
export function gitHostFor(ref: PullRequestRef, tokens: HostTokens): GitHost {
  const trusted = isTrustedHost(ref, tokens.trustedOrigins)
  switch (ref.host) {
    case GitHostKind.GitHub:
      return trusted ? new GitHubHost(ref, tokens.github) : new GitHubHost(ref, undefined, untrustedHostHint(ref.webOrigin, "GITHUB_TOKEN", TRUSTED_GITHUB_HOSTS_VARIABLE))
    case GitHostKind.GitLab:
      return trusted ? new GitLabHost(ref, tokens.gitlab) : new GitLabHost(ref, undefined, untrustedHostHint(ref.webOrigin, "GITLAB_TOKEN", TRUSTED_GITLAB_HOSTS_VARIABLE))
    default:
      return assertNever(ref)
  }
}

function untrustedHostHint(origin: string, tokenVariable: string, trustVariable: string): string {
  return `Walkdiff sent no token, because ${origin} is not a trusted host. If you trust it and it needs a token, set ${tokenVariable} and add the host to ${trustVariable}.`
}

function assertNever(value: never): never {
  throw new Error(`Unhandled git host: ${JSON.stringify(value)}`)
}
