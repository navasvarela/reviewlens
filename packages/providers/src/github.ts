import { commitShaSchema, GitHostKind } from "@lens/review-model"
import type { CommitSha } from "@lens/review-model"
import { z } from "zod"
import type { GitHost, GitHttpAuth, PullRequestSnapshot } from "./gitHost.ts"
import { getJson } from "./http.ts"
import type { GitHubPullRequestRef } from "./pullRequestUrl.ts"

const GITHUB_DOT_COM_ORIGIN = "https://github.com"
const GITHUB_DOT_COM_API = "https://api.github.com"
const GITHUB_API_VERSION = "2022-11-28"
// GitHub accepts any username with a token over HTTPS; this is the one its docs use.
const GITHUB_GIT_USERNAME = "x-access-token"
const USER_AGENT = "lens-review"
const AUTH_HINT = "Set GITHUB_TOKEN (or GH_TOKEN) to a token that can read this repository."
const DELETED_USER_LOGIN = "ghost"

const branchTipSchema = z.object({ ref: z.string(), sha: commitShaSchema })

const pullSchema = z.object({
  html_url: z.url(),
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  // GitHub returns null for accounts that have since been deleted.
  user: z.object({ login: z.string() }).nullable(),
  base: branchTipSchema,
  head: branchTipSchema,
})

const compareSchema = z.object({
  merge_base_commit: z.object({ sha: commitShaSchema }),
})

export class GitHubHost implements GitHost {
  readonly #ref: GitHubPullRequestRef
  readonly #token: string | undefined

  constructor(ref: GitHubPullRequestRef, token: string | undefined) {
    this.#ref = ref
    this.#token = token
  }

  async fetchPullRequest(): Promise<PullRequestSnapshot> {
    const { owner, repo, number, webOrigin } = this.#ref
    const repoApi = `${apiBase(webOrigin)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    const pull = await this.#get(`${repoApi}/pulls/${number}`, pullSchema)
    const mergeBaseSha = await this.#mergeBase(repoApi, pull.base.sha, pull.head.sha)

    return {
      pullRequest: {
        host: GitHostKind.GitHub,
        url: pull.html_url,
        number: pull.number,
        title: pull.title,
        description: pull.body ?? "",
        author: pull.user?.login ?? DELETED_USER_LOGIN,
        baseRef: pull.base.ref,
        headRef: pull.head.ref,
        baseSha: pull.base.sha,
        headSha: pull.head.sha,
        mergeBaseSha,
      },
      cloneUrl: `${webOrigin}/${owner}/${repo}.git`,
      gitAuth: this.#gitAuth(),
    }
  }

  async #mergeBase(repoApi: string, base: CommitSha, head: CommitSha): Promise<CommitSha> {
    const comparison = await this.#get(`${repoApi}/compare/${base}...${head}`, compareSchema)
    return comparison.merge_base_commit.sha
  }

  #get<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": USER_AGENT,
    }
    if (this.#token !== undefined) {
      headers.Authorization = `Bearer ${this.#token}`
    }
    return getJson({ url, headers, schema, authHint: AUTH_HINT })
  }

  #gitAuth(): GitHttpAuth | undefined {
    return this.#token === undefined ? undefined : { username: GITHUB_GIT_USERNAME, token: this.#token }
  }
}

// GitHub Enterprise Server serves its REST API under /api/v3 on the web host.
function apiBase(webOrigin: string): string {
  return webOrigin === GITHUB_DOT_COM_ORIGIN ? GITHUB_DOT_COM_API : `${webOrigin}/api/v3`
}
