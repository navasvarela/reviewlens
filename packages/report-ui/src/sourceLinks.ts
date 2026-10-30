import { CitationSide, GitHostKind } from "@lens/review-model"
import type { PullRequest } from "@lens/review-model"

/**
 * A link to a line of a file on the host's own file viewer: at the head commit by default,
 * or at the merge base for lines that exist only before the change.
 */
export function sourceLineUrl(pullRequest: PullRequest, path: string, line: number, side: CitationSide = CitationSide.After): string {
  const commit = side === CitationSide.Before ? pullRequest.mergeBaseSha : pullRequest.headSha
  const encodedPath = path.split("/").map(encodeURIComponent).join("/")
  const blobSegment = pullRequest.host === GitHostKind.GitLab ? "-/blob" : "blob"
  return `${pullRequest.repositoryWebUrl}/${blobSegment}/${commit}/${encodedPath}#L${line}`
}
