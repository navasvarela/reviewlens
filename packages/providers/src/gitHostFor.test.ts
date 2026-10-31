import { afterEach, describe, expect, it, vi } from "vitest"
import { gitHostFor } from "./gitHostFor.ts"
import type { HostTokens } from "./gitHost.ts"
import { parsePullRequestUrl } from "./pullRequestUrl.ts"
import type { TrustedOrigins } from "./trustedHosts.ts"

const GITHUB_TOKEN = "github-secret"
const GITLAB_TOKEN = "gitlab-secret"
const NOTHING_TRUSTED = { github: [], gitlab: [] }
const tokens = (trustedOrigins: TrustedOrigins = NOTHING_TRUSTED): HostTokens => ({ github: GITHUB_TOKEN, gitlab: GITLAB_TOKEN, trustedOrigins })

/** Fetches the PR against a host that refuses it, and returns what was sent and the error. */
async function attempt(url: string, hostTokens: HostTokens): Promise<{ sent: string; error: string }> {
  const fetchStub = vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 }))
  vi.stubGlobal("fetch", fetchStub)
  const error = await gitHostFor(parsePullRequestUrl(url), hostTokens)
    .fetchPullRequest()
    .then(
      () => "",
      (failure: unknown) => String(failure),
    )
  return { sent: JSON.stringify(fetchStub.mock.calls.map(([, init]) => init?.headers)), error }
}

describe("gitHostFor", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ["https://github.com/o/r/pull/1", GITHUB_TOKEN],
    ["https://GitHub.com:443/o/r/pull/1", GITHUB_TOKEN],
    ["https://gitlab.com/g/p/-/merge_requests/1", GITLAB_TOKEN],
  ])("sends the matching token to %s", async (url, token) => {
    expect((await attempt(url, tokens())).sent).toContain(token)
  })

  it.each([
    ["an unknown host", "https://evil.example/o/r/pull/1"],
    ["an unknown GitLab host", "https://evil.example/g/p/-/merge_requests/1"],
    ["a look-alike host", "https://github.com.evil.example/o/r/pull/1"],
    ["a host hidden behind a username", "https://github.com@evil.example/o/r/pull/1"],
    ["plain http", "http://github.com/o/r/pull/1"],
    ["another port", "https://github.com:8443/o/r/pull/1"],
    ["a GitHub-shaped link on GitLab", "https://gitlab.com/o/r/pull/1"],
    ["a GitLab-shaped link on GitHub", "https://github.com/g/p/-/merge_requests/1"],
  ])("sends no token to %s, and says why", async (_name, url) => {
    const { sent, error } = await attempt(url, tokens())
    expect(sent).not.toContain(GITHUB_TOKEN)
    expect(sent).not.toContain(GITLAB_TOKEN)
    expect(error).toContain("is not a trusted host")
  })

  it("sends a token to a host on the matching list only", async () => {
    const trusted = tokens({ github: ["https://git.acme.internal"], gitlab: [] })
    expect((await attempt("https://git.acme.internal/o/r/pull/1", trusted)).sent).toContain(GITHUB_TOKEN)
    expect((await attempt("https://git.acme.internal/g/p/-/merge_requests/1", trusted)).sent).not.toContain(GITLAB_TOKEN)
    expect((await attempt("http://git.acme.internal/o/r/pull/1", trusted)).sent).not.toContain(GITHUB_TOKEN)
  })

  it("keeps the usual token advice for a trusted host", async () => {
    const { error } = await attempt("https://github.com/o/r/pull/1", tokens())
    expect(error).toContain("Set GITHUB_TOKEN")
    expect(error).not.toContain("trusted host")
  })
})
