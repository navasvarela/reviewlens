import type { ReactElement } from "react"
import type { ChangedFile, PullRequest } from "@lens/review-model"
import { summarizeFile } from "../unitChange.ts"

const SHORT_SHA_LENGTH = 7

interface PullRequestHeaderProps {
  readonly pullRequest: PullRequest
  readonly files: readonly ChangedFile[]
}

export function PullRequestHeader({ pullRequest, files }: PullRequestHeaderProps): ReactElement {
  const additions = files.reduce((sum, file) => sum + file.diff.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.diff.deletions, 0)
  const summaries = files.map(summarizeFile)
  const needsAttention = summaries.reduce((sum, summary) => sum + summary.needsAttention, 0)
  const quiet = summaries.reduce((sum, summary) => sum + summary.quiet, 0)
  const skippable = files.filter((file) => file.noise !== null).length

  return (
    <header className="header">
      <h1>
        {pullRequest.title}{" "}
        <a href={pullRequest.url} target="_blank" rel="noreferrer">
          #{pullRequest.number}
        </a>
      </h1>
      <p className="meta">
        <strong>{pullRequest.author}</strong> wants to merge <code>{pullRequest.headRef}</code> into{" "}
        <code>{pullRequest.baseRef}</code> · {files.length} files · <span className="added">+{additions}</span>{" "}
        <span className="removed">−{deletions}</span> · diff {pullRequest.mergeBaseSha.slice(0, SHORT_SHA_LENGTH)}..
        {pullRequest.headSha.slice(0, SHORT_SHA_LENGTH)}
      </p>
      <p className="review-summary">
        <strong>{needsAttention}</strong> code {needsAttention === 1 ? "unit changed" : "units changed"} in ways that need review
        {quiet > 0 && <> · {quiet} collapsed as formatting, comments, renames or moves</>}
        {skippable > 0 && <> · {skippable} skippable {skippable === 1 ? "file" : "files"}</>}
      </p>
    </header>
  )
}
