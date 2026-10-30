import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Anthropic from "@anthropic-ai/sdk"
import { commitShaSchema } from "@lens/review-model"
import type { ChangedFile, ChangedUnit, CommitSha, PullRequest } from "@lens/review-model"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runGit } from "../git.ts"
import { AnthropicProvider } from "./anthropicProvider.ts"
import { validateOutput } from "./output.ts"
import type { RawAiOutput } from "./output.ts"
import { buildPrompt } from "./prompt.ts"
import type { ReviewContext } from "./prompt.ts"
import { AiUnavailableError } from "./provider.ts"
import type { AiCompletion, AiProvider } from "./provider.ts"
import { reviewWithAi } from "./reviewWithAi.ts"

const SHA = commitShaSchema.parse("a".repeat(40))

const PULL_REQUEST: PullRequest = {
  host: "github",
  url: "https://github.com/acme/app/pull/7",
  repositoryWebUrl: "https://github.com/acme/app",
  number: 7,
  title: "Cap retries",
  description: "Limits retries to three attempts.",
  author: "dev",
  baseRef: "main",
  headRef: "cap-retries",
  baseSha: SHA,
  headSha: SHA,
  mergeBaseSha: SHA,
}

function modifiedUnit(name: string, startLine: number, body: string): ChangedUnit {
  return {
    kind: "function",
    name,
    qualifiedName: name,
    facts: null,
    change: {
      kind: "modified",
      weight: "semantic",
      before: { startLine, endLine: startLine + 2, text: `def ${name}():\n    ${body}\n    return 1`, elidesNestedUnits: false },
      after: { startLine, endLine: startLine + 2, text: `def ${name}():\n    ${body} + 1\n    return 1`, elidesNestedUnits: false },
    },
    impact: null,
  }
}

function fileWith(path: string, units: readonly ChangedUnit[]): ChangedFile {
  return {
    diff: { status: "modified", path, additions: 1, deletions: 1, content: { kind: "text", hunks: [] } },
    noise: null,
    syntax: { status: "analyzed", language: "python", units, outline: [], calls: [] },
  }
}

const CONTEXT: ReviewContext = {
  pullRequest: PULL_REQUEST,
  files: [fileWith("app/retry.py", [modifiedUnit("retry", 10, "attempts = 3"), modifiedUnit("backoff", 20, "delay = 2")])],
  risk: { securityLevel: "low", findings: [], notChecked: [] },
}

describe("buildPrompt", () => {
  it("numbers unit lines by file line and records the ranges it shows", () => {
    const plan = buildPrompt(CONTEXT, 40_000)
    expect(plan.text).toContain('<unit id="U1" path="app/retry.py" name="retry" kind="function" change="modified (semantic)">')
    expect(plan.text).toContain("11|     attempts = 3 + 1")
    expect(plan.shownRanges).toContainEqual({ path: "app/retry.py", side: "after", startLine: 10, endLine: 12 })
    expect(plan.summarizedOnly).toBe(0)
  })

  it("lists units by name only once the budget is spent, and counts them", () => {
    const plan = buildPrompt(CONTEXT, 2_050)
    expect(plan.summarizedOnly).toBe(2)
    expect(plan.text).toContain('summarized="input budget reached"/>')
    expect(plan.shownRanges).toEqual([])
    expect([...plan.unitsById.keys()]).toEqual(["U1", "U2"])
  })
})

describe("validateOutput", () => {
  const plan = buildPrompt(CONTEXT, 40_000)
  const cite = (startLine: number, endLine: number) => ({ path: "app/retry.py", side: "after" as const, startLine, endLine })

  it("drops statements whose citations fall outside the shown code, keeping notFound claims", () => {
    const raw: RawAiOutput = {
      chapters: [],
      intent: [
        { claim: "Caps retries at three", verdict: "matches", explanation: "attempts = 3", citations: [cite(11, 11)] },
        { claim: "Adds jitter", verdict: "notFound", explanation: "No jitter in the change", citations: [] },
        { claim: "Changes logging", verdict: "undocumented", explanation: "Invented line", citations: [cite(400, 401)] },
      ],
      questions: [
        { question: "What happens on the fourth failure?", why: "The cap is new", citations: [cite(10, 12), cite(5, 6)] },
        { question: "Uncited?", why: "No evidence", citations: [] },
      ],
    }
    const result = validateOutput(raw, plan)
    expect(result.intent.map((entry) => entry.verdict)).toEqual(["matches", "notFound"])
    expect(result.questions).toEqual([{ question: "What happens on the fourth failure?", why: "The cap is new", citations: [cite(10, 12)] }])
    expect(result.droppedStatements).toBe(2)
  })

  it("places each known unit once and gathers the ones the model left out", () => {
    const raw: RawAiOutput = {
      chapters: [
        { title: "Retry policy", summary: "Caps attempts", unitIds: ["U1", "U1", "U99"] },
        { title: "Empty", summary: "Nothing real", unitIds: ["U42"] },
      ],
      intent: [],
      questions: [],
    }
    expect(validateOutput(raw, plan).chapters).toEqual([
      { title: "Retry policy", summary: "Caps attempts", units: [{ path: "app/retry.py", qualifiedName: "retry" }] },
      { title: "Other changes", summary: "Units the model did not place in a chapter.", units: [{ path: "app/retry.py", qualifiedName: "backoff" }] },
    ])
  })
})

class FakeProvider implements AiProvider {
  readonly model = "claude-opus-5-5"
  calls = 0
  readonly #result: AiCompletion | AiUnavailableError

  constructor(result: AiCompletion | AiUnavailableError) {
    this.#result = result
  }

  async complete(): Promise<AiCompletion> {
    this.calls++
    if (this.#result instanceof AiUnavailableError) throw this.#result
    return this.#result
  }
}

const COMPLETION: AiCompletion = {
  model: "claude-opus-5-5",
  usage: { inputTokens: 10_000, outputTokens: 2_000 },
  output: {
    chapters: [{ title: "Retry policy", summary: "Caps attempts", unitIds: ["U1", "U2"] }],
    intent: [],
    questions: [{ question: "Is three enough?", why: "New cap", citations: [{ path: "app/retry.py", side: "after", startLine: 11, endLine: 11 }] }],
  },
}

describe("reviewWithAi", () => {
  let repoDir = ""
  let cacheDir = ""
  let head = SHA

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "lens-ai-repo-"))
    cacheDir = await mkdtemp(join(tmpdir(), "lens-ai-cache-"))
    const env = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" }
    await runGit(["init", "--quiet"], { cwd: repoDir })
    await runGit(["commit", "--quiet", "--allow-empty", "--message", "empty"], { cwd: repoDir, env })
    head = commitShaSchema.parse((await runGit(["rev-parse", "HEAD"], { cwd: repoDir })).trim())
  })

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true })
    await rm(cacheDir, { recursive: true, force: true })
  })

  it("returns the validated review with usage and cost, then serves the same prompt from cache", async () => {
    const provider = new FakeProvider(COMPLETION)
    const request = { repoDir, base: head, head, context: CONTEXT, provider, cacheDir, maxInputTokens: 40_000 }
    const first = await reviewWithAi(request)
    expect(first).toMatchObject({ status: "completed", cached: false, droppedStatements: 0, estimatedCostUsd: 0.08 })
    expect(await reviewWithAi(request)).toMatchObject({ status: "completed", cached: true })
    expect(provider.calls).toBe(1)
  })

  it("reports a provider failure as an unavailable review instead of failing the run", async () => {
    const provider = new FakeProvider(new AiUnavailableError("rate limited by the Anthropic API; try again shortly"))
    const otherContext = { ...CONTEXT, pullRequest: { ...PULL_REQUEST, title: "Different prompt" } }
    expect(await reviewWithAi({ repoDir, base: head, head, context: otherContext, provider, cacheDir, maxInputTokens: 40_000 })).toEqual({
      status: "unavailable",
      reason: "rate limited by the Anthropic API; try again shortly",
    })
  })
})

describe("reviewWithAi in a repository that forbids AI", () => {
  const env = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" }
  let repoDir = ""

  const commitConfig = async (content: string): Promise<CommitSha> => {
    await writeFile(join(repoDir, ".lens.json"), content)
    await runGit(["add", ".lens.json"], { cwd: repoDir })
    await runGit(["commit", "--quiet", "--allow-empty", "--message", "config"], { cwd: repoDir, env })
    return commitShaSchema.parse((await runGit(["rev-parse", "HEAD"], { cwd: repoDir })).trim())
  }

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "lens-ai-forbidden-"))
    await runGit(["init", "--quiet"], { cwd: repoDir })
  })

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true })
  })

  it.each([
    { name: "the merge base forbids it and the PR tries to allow it", base: '{"ai":{"allowed":false}}', head: '{"ai":{"allowed":true}}' },
    { name: "the PR forbids it", base: "{}", head: '{"ai":{"allowed":false}}' },
    { name: "the PR breaks the config", base: "{}", head: "not json" },
  ])("never calls the provider when $name", async ({ base, head }) => {
    const baseSha = await commitConfig(base)
    const headSha = await commitConfig(head)
    const provider = new FakeProvider(COMPLETION)
    const review = await reviewWithAi({ repoDir, base: baseSha, head: headSha, context: CONTEXT, provider, cacheDir: repoDir, maxInputTokens: 40_000 })
    expect(review).toEqual({ status: "unavailable", reason: ".lens.json forbids sending this repository's code to a model" })
    expect(provider.calls).toBe(0)
  })
})

describe("AnthropicProvider against a local stand-in for the API", () => {
  let baseURL = ""
  let lastRequest: unknown
  let respond: (body: unknown) => { status: number; body: unknown } = () => ({ status: 500, body: {} })
  const server = createServer((request, response) => {
    let text = ""
    request.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")))
    request.on("end", () => {
      lastRequest = JSON.parse(text)
      const reply = respond(lastRequest)
      response.writeHead(reply.status, { "Content-Type": "application/json" })
      response.end(JSON.stringify(reply.body))
    })
  })

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    baseURL = typeof address === "object" && address !== null ? `http://127.0.0.1:${(address satisfies AddressInfo).port}` : ""
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const client = (): Anthropic => new Anthropic({ apiKey: "test-key", baseURL, maxRetries: 0 })

  it("sends a structured-output request with fallbacks and parses the reply", async () => {
    respond = () => ({
      status: 200,
      body: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(COMPLETION.output) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1234, output_tokens: 56 },
      },
    })
    const completion = await new AnthropicProvider("claude-opus-5-5", client()).complete("system text", "prompt text")
    expect(completion).toEqual({ model: "claude-opus-5-5", usage: { inputTokens: 1234, outputTokens: 56 }, output: COMPLETION.output })
    expect(lastRequest).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      system: "system text",
      output_config: { effort: "high", format: { type: "json_schema" } },
      messages: [{ role: "user", content: "prompt text" }],
    })
  })

  it("maps a rejected credential to an unavailable review with a fix", async () => {
    respond = () => ({ status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } })
    await expect(new AnthropicProvider("claude-opus-5-5", client()).complete("s", "p")).rejects.toThrow(
      new AiUnavailableError("Anthropic rejected the credentials; set ANTHROPIC_API_KEY or run `ant auth login`"),
    )
  })
})
