import { GitHostKind } from "@lens/review-model"
import type { PullRequestRef } from "./pullRequestUrl.ts"

/** Hosts beyond github.com and gitlab.com that may receive each kind of token, as URL origins. */
export interface TrustedOrigins {
  readonly github: readonly string[]
  readonly gitlab: readonly string[]
}

export const TRUSTED_GITHUB_HOSTS_VARIABLE = "LENS_TRUSTED_GITHUB_HOSTS"
export const TRUSTED_GITLAB_HOSTS_VARIABLE = "LENS_TRUSTED_GITLAB_HOSTS"

const GITHUB_DOT_COM_ORIGIN = "https://github.com"
const GITLAB_DOT_COM_ORIGIN = "https://gitlab.com"

/**
 * Whether this link's host may receive the token for its kind of host. Links are pasted by
 * hand and their kind is read from the path, so neither the host name nor the kind can be
 * taken on trust: `https://evil.example/a/b/pull/1` would otherwise receive a GitHub token,
 * and `https://gitlab.com/a/b/pull/1` would receive a GitHub token at GitLab. Comparing
 * whole origins also keeps a token off plain http and off look-alikes such as
 * `github.com.evil.example`.
 */
export function isTrustedHost(ref: PullRequestRef, trusted: TrustedOrigins): boolean {
  return ref.host === GitHostKind.GitHub
    ? ref.webOrigin === GITHUB_DOT_COM_ORIGIN || trusted.github.includes(ref.webOrigin)
    : ref.webOrigin === GITLAB_DOT_COM_ORIGIN || trusted.gitlab.includes(ref.webOrigin)
}
