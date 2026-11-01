import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { request } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commitShaSchema, REVIEW_MODEL_SCHEMA_VERSION, DEFAULT_APP_SETTINGS } from "@walkdiff/review-model"
import type { ReviewModel } from "@walkdiff/review-model"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { parsePullRequestUrl } from "@walkdiff/providers"
import type { PullRequestRef } from "@walkdiff/providers"
import { hostTokensFor, readHostTokens } from "../environment.ts"
import { API_KEY_HEADER, startAppServer, withMeta } from "./appServer.ts"
import type { AppServer } from "./appServer.ts"
import { ReviewService } from "./reviewService.ts"
import type { GeneratedReport } from "./reviewService.ts"
import { ReviewStore } from "./reviewStore.ts"

const SHA = commitShaSchema.parse("a".repeat(40))
const PR_URL = "https://github.com/acme/app/pull/7"

function fakeModel(title: string): ReviewModel {
  return {
    schemaVersion: REVIEW_MODEL_SCHEMA_VERSION,
    generatedAt: "2026-10-30T00:00:00.000Z",
    pullRequest: { host: "github", url: PR_URL, repositoryWebUrl: "https://github.com/acme/app", number: 7, title, description: "", author: "dev", baseRef: "main", headRef: "x", baseSha: SHA, headSha: SHA, mergeBaseSha: SHA },
    files: [],
    risk: { securityLevel: "high", findings: [], checksRun: [], notChecked: [] },
    ai: { status: "disabled" },
    testCoverage: null,
    feedbackUrl: null,
  }
}

describe("ReviewStore and ReviewService", () => {
  let dir = ""
  let store: ReviewStore
  let calls: string[] = []
  let outcome: (url: string) => Promise<GeneratedReport> = async () => ({ model: fakeModel("Cap retries"), reportDir: "/tmp/report" })

  const service = (): ReviewService =>
    new ReviewService(
      store,
      (ref, ai) => {
        calls.push(`${ref.number}:${ai}`)
        return outcome(ref.webOrigin)
      },
      () => undefined,
    )

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "walkdiff-store-"))
    store = new ReviewStore(join(dir, "walkdiff.db"), () => new Date("2026-10-30T10:00:00.000Z"))
    calls = []
    outcome = async () => ({ model: fakeModel("Cap retries"), reportDir: "/tmp/report" })
  })

  afterEach(async () => {
    store.close()
    await rm(dir, { recursive: true, force: true })
  })

  it("adds a review, analyzes it and records the summary", async () => {
    const reviews = service()
    expect(reviews.add({ url: PR_URL, ai: false })).toMatchObject({ status: "queued", displayName: "acme/app#7", hasReport: false, title: null })
    await reviews.idle()
    expect(store.list()).toMatchObject([{ status: "ready", title: "Cap retries", author: "dev", securityLevel: "high", hasReport: true, unitsToReview: 0, findings: 0, error: null }])
    expect(store.reportDirOf(1)).toBe("/tmp/report")
  })

  it("treats any link to the same PR as one review and refreshes it", async () => {
    const reviews = service()
    const first = reviews.add({ url: `${PR_URL}/files`, ai: false })
    await reviews.idle()
    expect(reviews.add({ url: `  ${PR_URL}/  `, ai: false }).id).toBe(first.id)
    await reviews.idle()
    expect(store.list()).toHaveLength(1)
    expect(calls).toEqual(["7:false", "7:false"])
  })

  it("rejects a link that is not a pull request", () => {
    expect(() => service().add({ url: "https://github.com/acme/app/issues/7", ai: false })).toThrow(/Not a pull request URL/)
    expect(store.list()).toEqual([])
  })

  it("records a failure with its reason and keeps the earlier report", async () => {
    const reviews = service()
    reviews.add({ url: PR_URL, ai: false })
    await reviews.idle()
    outcome = async () => {
      throw new Error("Set GITHUB_TOKEN")
    }
    reviews.refresh(1)
    await reviews.idle()
    expect(store.get(1)).toMatchObject({ status: "failed", error: "Set GITHUB_TOKEN", hasReport: true, title: "Cap retries" })
  })

  it("analyzes one at a time, and passes along the AI choice", async () => {
    const reviews = service()
    reviews.add({ url: PR_URL, ai: true })
    reviews.add({ url: "https://github.com/acme/app/pull/8", ai: false })
    expect(store.get(1)?.status).toBe("analyzing")
    expect(store.get(2)?.status).toBe("queued")
    await reviews.idle()
    expect(calls).toEqual(["7:true", "8:false"])
  })

  it("survives a restart, marking unfinished analyses as interrupted", () => {
    store.add({ url: PR_URL, host: "github", displayName: "acme/app#7", ai: false })
    store.close()
    store = new ReviewStore(join(dir, "walkdiff.db"), () => new Date())
    store.markInterrupted()
    expect(store.list()).toMatchObject([{ status: "failed", error: expect.stringContaining("Refresh") }])
  })

  it("does not bring back a review removed during its analysis", async () => {
    const reviews = service()
    reviews.add({ url: PR_URL, ai: false })
    store.remove(1)
    await reviews.idle()
    expect(store.list()).toEqual([])
  })
})

describe("the app server", () => {
  let dir = ""
  let store: ReviewStore
  let server: AppServer
  let base = ""
  const KEY = "test-key"

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "walkdiff-app-"))
    store = new ReviewStore(join(dir, "walkdiff.db"), () => new Date("2026-10-30T10:00:00.000Z"))
    await writeFile(join(dir, "index.html"), "<html><head></head><body>report page</body></html>")
    const service = new ReviewService(store, async () => ({ model: fakeModel("Cap retries"), reportDir: dir }), () => undefined)
    server = await startAppServer(store, service, { port: 0, apiKey: KEY, log: () => undefined })
    base = server.url
  })

  afterAll(async () => {
    await server.close()
    store.close()
    await rm(dir, { recursive: true, force: true })
  })

  it("refuses API calls without the key, even reads", async () => {
    expect((await fetch(`${base}api/reviews`)).status).toBe(401)
    expect((await fetch(`${base}api/reviews`, { method: "POST", body: JSON.stringify({ url: PR_URL, ai: false }) })).status).toBe(401)
  })

  it("refuses requests whose Host is not this server, which DNS rebinding would produce", async () => {
    const status = await new Promise<number | undefined>((done) => {
      request(base, { headers: { Host: "evil.example" } }, (response) => {
        response.resume()
        done(response.statusCode)
      }).end()
    })
    expect(status).toBe(403)
  })

  it("adds, lists, serves and removes a review through the API", async () => {
    const headers = { [API_KEY_HEADER]: KEY, "Content-Type": "application/json" }
    const added = await fetch(`${base}api/reviews`, { method: "POST", headers, body: JSON.stringify({ url: PR_URL, ai: false }) })
    expect(added.status).toBe(202)
    await new Promise((done) => setTimeout(done, 20))

    const list: unknown = await (await fetch(`${base}api/reviews`, { headers })).json()
    expect(list).toMatchObject([{ id: 1, status: "ready", hasReport: true }])

    const page = await fetch(`${base}reviews/1/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('name="walkdiff-home"')
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'")

    expect((await fetch(`${base}api/reviews/1`, { method: "DELETE", headers })).status).toBe(200)
    expect((await fetch(`${base}reviews/1/`)).status).toBe(404)
  })

  describe("settings", () => {
    const headers = { [API_KEY_HEADER]: KEY, "Content-Type": "application/json" }
    const put = (body: unknown): Promise<Response> => fetch(`${base}api/settings`, { method: "PUT", headers, body: JSON.stringify(body) })

    it("needs the key, even to read", async () => {
      expect((await fetch(`${base}api/settings`)).status).toBe(401)
      expect((await fetch(`${base}api/settings`, { method: "PUT", body: "{}" })).status).toBe(401)
      expect((await fetch(`${base}api/settings/test-ai`, { method: "POST" })).status).toBe(401)
    })

    it("saves settings that survive a reload, and never exposes a key", async () => {
      const settings = { disabledChecks: ["semgrep"], ai: { provider: "openaiCompatible", model: "llama3.2", baseUrl: "http://localhost:11434/v1", maxInputTokens: 1000, enabledByDefault: true } }
      expect((await put(settings)).status).toBe(200)
      const view = await (await fetch(`${base}api/settings`, { headers })).text()
      expect(JSON.parse(view)).toMatchObject({ settings, aiKeys: { anthropic: false, openaiCompatible: false } })
      expect(store.getSettings()).toEqual(settings)
      store.saveSettings(DEFAULT_APP_SETTINGS)
    })

    it("refuses an address that would expose code, with a reason", async () => {
      const response = await put({ disabledChecks: [], ai: { provider: "openaiCompatible", model: "m", baseUrl: "http://api.example.com", maxInputTokens: 1, enabledByDefault: false } })
      expect(response.status).toBe(400)
      expect(await response.text()).toContain("https")
      expect(store.getSettings()).toEqual(DEFAULT_APP_SETTINGS)
    })

    it("reports a failed connection test as a result, not an error", async () => {
      store.saveSettings({ disabledChecks: [], ai: { provider: "openaiCompatible", model: "m", baseUrl: "http://127.0.0.1:1/v1", maxInputTokens: 1, enabledByDefault: false } })
      const response = await fetch(`${base}api/settings/test-ai`, { method: "POST", headers })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: false, message: expect.stringContaining("could not reach") })
      store.saveSettings(DEFAULT_APP_SETTINGS)
    })

    it("falls back to the defaults if what's saved can't be read", () => {
      expect(store.getSettings()).toEqual(DEFAULT_APP_SETTINGS)
    })
  })

  it("explains a bad link", async () => {
    const headers = { [API_KEY_HEADER]: KEY, "Content-Type": "application/json" }
    const response = await fetch(`${base}api/reviews`, { method: "POST", headers, body: JSON.stringify({ url: "nonsense", ai: false }) })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Not a pull request URL") })
  })

  it("keeps unexpected error details out of the response and logs them", async () => {
    const brokenStore = new ReviewStore(join(dir, "broken.db"), () => new Date("2026-10-30T10:00:00.000Z"))
    const logged: string[] = []
    const service = new ReviewService(brokenStore, async () => ({ model: fakeModel("x"), reportDir: dir }), () => undefined)
    const broken = await startAppServer(brokenStore, service, { port: 0, apiKey: KEY, log: (message) => logged.push(message) })
    brokenStore.close()
    const response = await fetch(`${broken.url}api/reviews`, { headers: { [API_KEY_HEADER]: KEY } })
    await broken.close()
    expect(response.status).toBe(500)
    expect(await response.text()).not.toMatch(/database|stack|\/.+\.ts/i)
    expect(logged.join()).toContain("/api/reviews")
  })

  it("says how to recover when a report is no longer on disk", async () => {
    const headers = { [API_KEY_HEADER]: KEY, "Content-Type": "application/json" }
    await fetch(`${base}api/reviews`, { method: "POST", headers, body: JSON.stringify({ url: PR_URL, ai: false }) })
    await new Promise((done) => setTimeout(done, 20))
    const [review] = store.list()
    await rm(join(dir, "index.html"))
    const page = await fetch(`${base}reviews/${review?.id ?? 0}/`)
    await writeFile(join(dir, "index.html"), "<html><head></head><body>report page</body></html>")
    await fetch(`${base}api/reviews/${review?.id ?? 0}`, { method: "DELETE", headers })
    expect(page.status).toBe(404)
    expect(await page.text()).toContain("Refresh the review")
  })

  it("adds its key to served pages only, not report files", () => {
    expect(withMeta("<head></head>", "abc")).toContain('content="abc"')
  })
})

describe("hostTokensFor", () => {
  const ref = (url: string): PullRequestRef => parsePullRequestUrl(url)
  const github = ref("https://github.com/o/r/pull/1")
  const enterprise = ref("https://git.acme.internal/o/r/pull/1")
  const recordingGh = (): { asked: string[]; run: (command: string, args: readonly string[]) => Promise<string> } => {
    const asked: string[] = []
    return {
      asked,
      run: async (_command, args) => {
        asked.push(args.join(" "))
        return "gh-token\n"
      },
    }
  }

  it("prefers the environment, and otherwise asks gh about that trusted host only", async () => {
    const { asked, run } = recordingGh()
    expect(await hostTokensFor(github, { GITHUB_TOKEN: "env" }, run)).toMatchObject({ github: "env" })
    expect(asked).toEqual([])
    expect(await hostTokensFor(enterprise, { WALKDIFF_TRUSTED_GITHUB_HOSTS: "git.acme.internal" }, run)).toMatchObject({ github: "gh-token" })
    expect(asked).toEqual(["auth token --hostname git.acme.internal"])
  })

  it("does not ask gh about an untrusted host or a GitLab link", async () => {
    const { asked, run } = recordingGh()
    expect((await hostTokensFor(enterprise, {}, run)).github).toBeUndefined()
    expect((await hostTokensFor(ref("http://github.com/o/r/pull/1"), {}, run)).github).toBeUndefined()
    expect((await hostTokensFor(ref("https://gitlab.com/g/p/-/merge_requests/1"), {}, run)).github).toBeUndefined()
    expect(asked).toEqual([])
  })

  it("leaves the token unset when gh is missing or signed out", async () => {
    expect((await hostTokensFor(github, {}, async () => undefined)).github).toBeUndefined()
  })
})

describe("readHostTokens", () => {
  it.each([
    ["git.acme.internal", ["https://git.acme.internal"]],
    [" a.example , b.example:8443 ,", ["https://a.example", "https://b.example:8443"]],
    ["http://intranet.example", ["http://intranet.example"]],
    ["", []],
  ])("reads trusted hosts from %j", (value, origins) => {
    expect(readHostTokens({ WALKDIFF_TRUSTED_GITLAB_HOSTS: value }).trustedOrigins).toEqual({ github: [], gitlab: origins })
  })

  it("rejects an entry that is not a host", () => {
    expect(() => readHostTokens({ WALKDIFF_TRUSTED_GITHUB_HOSTS: "not a host" })).toThrow("Not a host name")
  })

  it("trusts the CI server only inside that CI system", () => {
    expect(readHostTokens({ GITHUB_ACTIONS: "true", GITHUB_SERVER_URL: "https://ghe.example" }).trustedOrigins.github).toEqual(["https://ghe.example"])
    expect(readHostTokens({ GITLAB_CI: "true", CI_SERVER_URL: "https://gl.example" }).trustedOrigins.gitlab).toEqual(["https://gl.example"])
    expect(readHostTokens({ GITHUB_SERVER_URL: "https://ghe.example", CI_SERVER_URL: "https://gl.example" }).trustedOrigins).toEqual({ github: [], gitlab: [] })
  })
})
