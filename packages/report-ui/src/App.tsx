import { useEffect, useState } from "react"
import type { ReactElement } from "react"
import type { ReviewModel } from "@lens/review-model"
import { FileList } from "./components/FileList.tsx"
import { FileView } from "./components/FileView.tsx"
import { PullRequestHeader } from "./components/PullRequestHeader.tsx"
import { loadReview } from "./loadReview.ts"
import type { ReviewLoad } from "./loadReview.ts"

export function App(): ReactElement {
  const [load, setLoad] = useState<ReviewLoad>({ status: "loading" })

  useEffect(() => {
    void loadReview().then(setLoad)
  }, [])

  switch (load.status) {
    case "loading":
      return <p className="notice">Loading review…</p>
    case "failed":
      return <p className="notice notice-error">{load.message}</p>
    case "loaded":
      return <Report review={load.review} />
  }
}

interface ReportProps {
  readonly review: ReviewModel
}

function Report({ review }: ReportProps): ReactElement {
  const firstReviewable = review.files.find((file) => file.noise === null) ?? review.files.at(0)
  const [selectedPath, setSelectedPath] = useState(firstReviewable?.diff.path)
  const selectedFile = review.files.find((file) => file.diff.path === selectedPath)

  return (
    <div className="layout">
      <PullRequestHeader pullRequest={review.pullRequest} files={review.files} />
      <FileList files={review.files} selectedPath={selectedPath} onSelect={setSelectedPath} />
      <main className="content">
        {selectedFile === undefined ? <p className="notice">This pull request changes no files.</p> : <FileView key={selectedFile.diff.path} file={selectedFile} pullRequest={review.pullRequest} />}
      </main>
    </div>
  )
}
