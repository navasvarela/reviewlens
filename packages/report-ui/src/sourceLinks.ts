import { GitHostKind } from "@lens/review-model"
import type { PullRequest } from "@lens/review-model"

/** A link to a line of a file at the PR's head commit, on the host's own file viewer. */
export function sourceLineUrl(pullRequest: PullRequest, path: string, line: number): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/")
  const blobSegment = pullRequest.host === GitHostKind.GitLab ? "-/blob" : "blob"
  return `${pullRequest.repositoryWebUrl}/${blobSegment}/${pullRequest.headSha}/${encodedPath}#L${line}`
}
