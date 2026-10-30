import { useEffect, useState } from "react"
import type { ReactElement } from "react"
import type { ReviewModel } from "@lens/review-model"
import { FileList } from "./components/FileList.tsx"
import { FileView } from "./components/FileView.tsx"
import { PullRequestHeader } from "./components/PullRequestHeader.tsx"
import { Overview } from "./components/Overview.tsx"
import { loadReview } from "./loadReview.ts"
import type { ReviewLoad } from "./loadReview.ts"
import { findingsInFile } from "./risks.ts"

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

type Selection = { readonly kind: "overview" } | { readonly kind: "file"; readonly path: string }

const OVERVIEW: Selection = { kind: "overview" }

function Report({ review }: ReportProps): ReactElement {
  const [selection, setSelection] = useState<Selection>(OVERVIEW)
  const openFile = (path: string): void => setSelection({ kind: "file", path })
  const selectedPath = selection.kind === "file" ? selection.path : undefined
  const selectedFile = review.files.find((file) => file.diff.path === selectedPath)

  return (
    <div className="layout">
      <PullRequestHeader pullRequest={review.pullRequest} files={review.files} risk={review.risk} />
      <FileList
        files={review.files}
        findings={review.risk.findings}
        selectedPath={selectedPath}
        overviewSelected={selection.kind === "overview"}
        onSelect={openFile}
        onSelectOverview={() => setSelection(OVERVIEW)}
      />
      <main className="content">
        {selectedFile === undefined ? (
          <Overview risk={review.risk} ai={review.ai} feedbackUrl={review.feedbackUrl} pullRequest={review.pullRequest} onOpenFile={openFile} />
        ) : (
          <FileView
            key={selectedFile.diff.path}
            file={selectedFile}
            findings={findingsInFile(review.risk.findings, selectedFile.diff.path)}
            pullRequest={review.pullRequest}
          />
        )}
      </main>
    </div>
  )
}
