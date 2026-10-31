import { commitShaSchema, GitHostKind } from "@lens/review-model"
import { z } from "zod"
import type { GitHost, GitHttpAuth, PullRequestSnapshot } from "./gitHost.ts"
import { getJson, writeJson } from "./http.ts"
import type { WriteMethod } from "./http.ts"
import { COMMENTS_PER_PAGE, upsertMarkedComment } from "./markedComment.ts"
import type { MarkedComment } from "./markedComment.ts"
import type { GitLabMergeRequestRef } from "./pullRequestUrl.ts"

// GitLab requires this username when a personal access token is used as the git password.
const GITLAB_GIT_USERNAME = "oauth2"
const AUTH_HINT = "Set GITLAB_TOKEN to a token with the read_api and read_repository scopes; posting comments needs the api scope."

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

const noteSchema = z.object({ id: z.number().int(), body: z.string().nullable() })

export class DiffNotReadyError extends Error {
  override readonly name = "DiffNotReadyError"

  constructor(url: string) {
    super(`GitLab has not computed the diff for ${url} yet; try again in a moment.`)
  }
}

export class GitLabHost implements GitHost {
  readonly #ref: GitLabMergeRequestRef
  readonly #token: string | undefined
  readonly #authHint: string

  constructor(ref: GitLabMergeRequestRef, token: string | undefined, authHint: string = AUTH_HINT) {
    this.#ref = ref
    this.#token = token
    this.#authHint = authHint
  }

  async fetchPullRequest(): Promise<PullRequestSnapshot> {
    const { webOrigin, projectPath } = this.#ref
    const url = this.#mergeRequestApi()
    const mergeRequest = await getJson({ url, headers: this.#headers(), schema: mergeRequestSchema, authHint: this.#authHint })
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

  upsertComment(comment: MarkedComment): Promise<void> {
    const notesUrl = `${this.#mergeRequestApi()}/notes`
    return upsertMarkedComment(
      {
        listPage: (page) =>
          getJson({
            url: `${notesUrl}?per_page=${COMMENTS_PER_PAGE}&page=${page}`,
            headers: this.#headers(),
            schema: z.array(noteSchema),
            authHint: this.#authHint,
          }),
        create: (body) => this.#write("POST", notesUrl, { body }),
        update: (id, body) => this.#write("PUT", `${notesUrl}/${id}`, { body }),
      },
      comment,
    )
  }

  #mergeRequestApi(): string {
    const { webOrigin, projectPath, number } = this.#ref
    return `${webOrigin}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${number}`
  }

  async #write(method: WriteMethod, url: string, body: unknown): Promise<void> {
    await writeJson({ method, url, body, headers: this.#headers(), schema: z.unknown(), authHint: this.#authHint })
  }

  #headers(): Record<string, string> {
    return this.#token === undefined ? {} : { "PRIVATE-TOKEN": this.#token }
  }

  #gitAuth(): GitHttpAuth | undefined {
    return this.#token === undefined ? undefined : { username: GITLAB_GIT_USERNAME, token: this.#token }
  }
}
