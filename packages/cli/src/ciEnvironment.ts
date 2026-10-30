import { readFile } from "node:fs/promises"
import { z } from "zod"
import { UsageError } from "./args.ts"

export type CiEnvironment = Readonly<Record<string, string | undefined>>

const pullRequestEventSchema = z.object({ pull_request: z.object({ html_url: z.url() }) })

/** Works out which PR this CI job is for, from the variables each CI system sets. */
export async function detectPullRequestUrl(env: CiEnvironment): Promise<string> {
  if (env.GITHUB_ACTIONS === "true") {
    return gitHubPullRequestUrl(env.GITHUB_EVENT_PATH)
  }
  if (env.GITLAB_CI === "true") {
    return gitLabMergeRequestUrl(env)
  }
  throw new UsageError("Missing the pull request URL (not running in GitHub Actions or GitLab CI)")
}

async function gitHubPullRequestUrl(eventPath: string | undefined): Promise<string> {
  if (eventPath === undefined) {
    throw new UsageError("GITHUB_EVENT_PATH is not set, so the pull request is unknown")
  }
  const event: unknown = JSON.parse(await readFile(eventPath, "utf8"))
  const parsed = pullRequestEventSchema.safeParse(event)
  if (!parsed.success) {
    throw new UsageError("This workflow run is not for a pull request; trigger it with `on: pull_request`")
  }
  return parsed.data.pull_request.html_url
}

function gitLabMergeRequestUrl(env: CiEnvironment): string {
  const { CI_MERGE_REQUEST_PROJECT_URL: projectUrl, CI_MERGE_REQUEST_IID: iid } = env
  if (projectUrl === undefined || iid === undefined) {
    throw new UsageError("This pipeline is not for a merge request; run the job on merge_request_event")
  }
  return `${projectUrl}/-/merge_requests/${iid}`
}
