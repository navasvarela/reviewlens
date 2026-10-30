import { commitShaSchema, GitHostKind } from "@lens/review-model"
import { z } from "zod"
import type { GitHost, GitHttpAuth, PullRequestSnapshot } from "./gitHost.ts"
import { getJson } from "./http.ts"
import type { GitLabMergeRequestRef } from "./pullRequestUrl.ts"

// GitLab requires this username when a personal access token is used as the git password.
const GITLAB_GIT_USERNAME = "oauth2"
const AUTH_HINT = "Set GITLAB_TOKEN to a token with the read_api and read_repository scopes."

const mergeRequestSchema = z.object({
  web_url: z.url(),
  iid: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  author: z.object({ username: z.string() }),
  source_branch: z.string(),
  target_branch: z.string(),
  // base_sha is the merge base, start_sha the target branch tip. Null until GitLab
  // has computed the merge request's diff, which happens shortly after it is opened.
  diff_refs: z
    .object({ base_sha: commitShaSchema, head_sha: commitShaSchema, start_sha: commitShaSchema })
    .nullable(),
})

export class DiffNotReadyError extends Error {
  override readonly name = "DiffNotReadyError"

  constructor(url: string) {
    super(`GitLab has not computed the diff for ${url} yet; try again in a moment.`)
  }
}

export class GitLabHost implements GitHost {
  readonly #ref: GitLabMergeRequestRef
  readonly #token: string | undefined

  constructor(ref: GitLabMergeRequestRef, token: string | undefined) {
    this.#ref = ref
    this.#token = token
  }

  async fetchPullRequest(): Promise<PullRequestSnapshot> {
    const { webOrigin, projectPath, number } = this.#ref
    const url = `${webOrigin}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${number}`
    const mergeRequest = await getJson({ url, headers: this.#headers(), schema: mergeRequestSchema, authHint: AUTH_HINT })
    if (mergeRequest.diff_refs === null) {
      throw new DiffNotReadyError(mergeRequest.web_url)
    }

    return {
      pullRequest: {
        host: GitHostKind.GitLab,
        url: mergeRequest.web_url,
        repositoryWebUrl: `${webOrigin}/${projectPath}`,
        number: mergeRequest.iid,
        title: mergeRequest.title,
        description: mergeRequest.description ?? "",
        author: mergeRequest.author.username,
        baseRef: mergeRequest.target_branch,
        headRef: mergeRequest.source_branch,
        baseSha: mergeRequest.diff_refs.start_sha,
        headSha: mergeRequest.diff_refs.head_sha,
        mergeBaseSha: mergeRequest.diff_refs.base_sha,
      },
      cloneUrl: `${webOrigin}/${projectPath}.git`,
      gitAuth: this.#gitAuth(),
    }
  }

  #headers(): Record<string, string> {
    return this.#token === undefined ? {} : { "PRIVATE-TOKEN": this.#token }
  }

  #gitAuth(): GitHttpAuth | undefined {
    return this.#token === undefined ? undefined : { username: GITLAB_GIT_USERNAME, token: this.#token }
  }
}
