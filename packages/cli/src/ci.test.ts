import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commitShaSchema, REVIEW_MODEL_SCHEMA_VERSION } from "@lens/review-model"
import type { ChangedFile, ReviewModel } from "@lens/review-model"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { parseCommand, UsageError } from "./args.ts"
import { detectPullRequestUrl } from "./ciEnvironment.ts"
import { runComment } from "./commentCommand.ts"
import { escapeMarkdown, renderSummaryComment, SUMMARY_COMMENT_MARKER } from "./summaryComment.ts"

const SHA = commitShaSchema.parse("a".repeat(40))

function modelWith(url: string, overrides: Partial<ReviewModel> = {}): ReviewModel {
  const file: ChangedFile = {
    diff: { status: "modified", path: "src/a.py", additions: 1, deletions: 1, content: { kind: "text", hunks: [] } },
    noise: null,
    syntax: {
      status: "analyzed",
      language: "python",
      outline: [],
      calls: [],
      units: [
        {
          kind: "function",
          name: "parse",
          qualifiedName: "parse",
          facts: null,
          change: {
            kind: "modified",
            weight: "semantic",
            before: { startLine: 1, endLine: 1, text: "a", elidesNestedUnits: false },
            after: { startLine: 1, endLine: 1, text: "b", elidesNestedUnits: false },
          },
          impact: {
            status: "traced",
            searchedName: "parse",
            totalReferences: 1,
            references: [{ path: "src/b.py", line: 2, callerQualifiedName: "run", confidence: "likely", touchedByPullRequest: false, snippet: "parse(x)" }],
          },
        },
      ],
    },
  }
  return {
    schemaVersion: REVIEW_MODEL_SCHEMA_VERSION,
    generatedAt: "2026-10-30T00:00:00Z",
    pullRequest: {
      host: "github",
      url,
      repositoryWebUrl: "https://github.com/acme/app",
      number: 7,
      title: "t",
      description: "",
      author: "dev",
      baseRef: "main",
      headRef: "x",
      baseSha: SHA,
      headSha: SHA,
      mergeBaseSha: SHA,
    },
    files: [file],
    risk: {
      securityLevel: "medium",
      findings: [
        { ruleId: "rust.unsafe", category: "dangerousApi", severity: "medium", title: "unsafe code", detail: "d", location: { path: "a.rs", line: 1 }, evidence: null },
        { ruleId: "rust.unsafe", category: "dangerousApi", severity: "medium", title: "unsafe code", detail: "d", location: { path: "b.rs", line: 2 }, evidence: null },
        { ruleId: "dependency.added", category: "dependency", severity: "low", title: "New dependency: @evil/pkg [x](http://bad)", detail: "d", location: { path: "package.json", line: 1 }, evidence: null },
      ],
      checksRun: [],
      notChecked: [{ check: "c", reason: "r" }],
    },
    ai: { status: "disabled" },
    feedbackUrl: "https://forms.example.com/lens",
    ...overrides,
  }
}

describe("renderSummaryComment", () => {
  const body = renderSummaryComment(modelWith("https://github.com/acme/app/pull/7"), "https://example.com/report")

  it("summarizes level, counts, grouped findings, the link and how to give feedback", () => {
    expect(body.startsWith(SUMMARY_COMMENT_MARKER)).toBe(true)
    expect(body).toContain("security level **Medium**")
    expect(body).toContain("**1** code unit to review")
    expect(body).toContain("**1** place this PR did not touch use code it changed")
    expect(body).toContain("- Medium: unsafe code (×2)\n")
    expect(body).toContain("[Open the full report](https://example.com/report)")
    expect(body).toContain("1 check did not run")
    expect(body).toContain("[leave feedback](https://forms.example.com/lens)")
  })

  it("neutralizes names from the PR", () => {
    expect(body).not.toContain("[x](http://bad)")
    expect(body).not.toContain("@evil")
    expect(escapeMarkdown("a\n# b `c` <img>")).toBe("a #​ b \\`c\\` \\<img\\>")
  })
})

describe("detectPullRequestUrl", () => {
  let dir = ""

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "lens-ci-"))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("reads the PR from the GitHub Actions event", async () => {
    const path = join(dir, "event.json")
    await writeFile(path, JSON.stringify({ pull_request: { html_url: "https://github.com/acme/app/pull/7" } }))
    expect(await detectPullRequestUrl({ GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: path })).toBe("https://github.com/acme/app/pull/7")
  })

  it("explains when a GitHub run is not for a PR", async () => {
    const path = join(dir, "push.json")
    await writeFile(path, JSON.stringify({ ref: "refs/heads/main" }))
    await expect(detectPullRequestUrl({ GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: path })).rejects.toThrow(UsageError)
  })

  it("builds the merge request URL in GitLab CI, nested groups included", async () => {
    const env = { GITLAB_CI: "true", CI_MERGE_REQUEST_PROJECT_URL: "https://gitlab.com/g/sub/app", CI_MERGE_REQUEST_IID: "9" }
    expect(await detectPullRequestUrl(env)).toBe("https://gitlab.com/g/sub/app/-/merge_requests/9")
  })

  it("asks for a URL outside CI", async () => {
    await expect(detectPullRequestUrl({})).rejects.toThrow(UsageError)
  })
})

describe("parseCommand", () => {
  it("accepts review without a URL and requires both comment options", () => {
    expect(parseCommand(["review", "--no-serve"])).toMatchObject({ kind: "review", options: { url: undefined, serve: false } })
    expect(() => parseCommand(["comment", "--report", "r"])).toThrow(UsageError)
    expect(() => parseCommand(["comment", "--report", "r", "--report-url", "javascript:alert(1)"])).toThrow(UsageError)
  })
})

/** Runs the real provider and fetch against a local stand-in for each host's API. */
describe("runComment against stand-in host APIs", () => {
  interface RecordedCall {
    readonly method: string
    readonly path: string
    readonly body: unknown
  }
  let calls: RecordedCall[] = []
  let existingComments: unknown[] = []
  let updateStatus = 200
  let createStatus = 201
  let origin = ""
  let reportDir = ""
  const logs: string[] = []

  const server = createServer((request, response) => {
    let text = ""
    request.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")))
    request.on("end", () => {
      const method = request.method ?? ""
      const path = request.url ?? ""
      calls.push({ method, path, body: text === "" ? null : JSON.parse(text) })
      const status = method === "PATCH" || method === "PUT" ? updateStatus : method === "POST" ? createStatus : 200
      response.writeHead(status, { "Content-Type": "application/json" })
      response.end(JSON.stringify(method === "GET" ? existingComments : { id: 1 }))
    })
  })
  const writes = (): RecordedCall[] => calls.filter((call) => call.method !== "GET")

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    origin = typeof address === "object" && address !== null ? `http://127.0.0.1:${address.port}` : ""
    reportDir = await mkdtemp(join(tmpdir(), "lens-comment-"))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(reportDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    calls = []
    existingComments = []
    updateStatus = 200
    createStatus = 201
    logs.length = 0
  })

  const run = async (pullRequestUrl: string, stepSummaryPath?: string): Promise<void> => {
    await writeFile(join(reportDir, "review.json"), JSON.stringify(modelWith(pullRequestUrl)))
    await runComment(
      { reportDir, reportUrl: "https://example.com/report" },
      { tokens: { github: "gh-token", gitlab: "gl-token", trustedOrigins: { github: [], gitlab: [] } }, stepSummaryPath, log: (message) => logs.push(message) },
    )
  }

  it("creates a GitHub comment when none exists, under Enterprise API paths", async () => {
    await run(`${origin}/acme/app/pull/7`)
    expect(writes()).toMatchObject([{ method: "POST", path: "/api/v3/repos/acme/app/issues/7/comments" }])
  })

  it("updates the earlier comment instead of adding another", async () => {
    existingComments = [{ id: 5, body: "unrelated" }, { id: 6, body: `${SUMMARY_COMMENT_MARKER}\nold` }]
    await run(`${origin}/acme/app/pull/7`)
    expect(writes()).toMatchObject([{ method: "PATCH", path: "/api/v3/repos/acme/app/issues/comments/6" }])
  })

  it("posts a new comment when the marked one belongs to someone else", async () => {
    existingComments = [{ id: 6, body: SUMMARY_COMMENT_MARKER }]
    updateStatus = 403
    await run(`${origin}/acme/app/pull/7`)
    expect(writes().map((call) => call.method)).toEqual(["PATCH", "POST"])
  })

  it("uses GitLab's notes API", async () => {
    existingComments = [{ id: 8, body: SUMMARY_COMMENT_MARKER }]
    await run(`${origin}/g/sub/app/-/merge_requests/9`)
    expect(writes()).toMatchObject([{ method: "PUT", path: "/api/v4/projects/g%2Fsub%2Fapp/merge_requests/9/notes/8" }])
  })

  it("warns rather than fails on a read-only token, and still writes the job summary", async () => {
    const summary = join(reportDir, "summary.md")
    await writeFile(summary, "")
    createStatus = 403
    await run(`${origin}/acme/app/pull/7`, summary)
    expect(logs.join("\n")).toContain("Could not post the summary comment")
    expect(await readFile(summary, "utf8")).toContain("ReviewLens")
  })
})
