import { describe, expect, it } from "vitest"
import { InvalidPullRequestUrlError, parsePullRequestUrl } from "./pullRequestUrl.ts"

describe("parsePullRequestUrl", () => {
  it.each([
    {
      input: "https://github.com/rust-lang/rust/pull/12345",
      expected: { host: "github", webOrigin: "https://github.com", owner: "rust-lang", repo: "rust", number: 12345 },
    },
    {
      input: "https://github.com/acme/api/pull/7/files",
      expected: { host: "github", webOrigin: "https://github.com", owner: "acme", repo: "api", number: 7 },
    },
    {
      input: "https://git.acme.internal/team/service/pull/3",
      expected: { host: "github", webOrigin: "https://git.acme.internal", owner: "team", repo: "service", number: 3 },
    },
    {
      input: "https://gitlab.com/gitlab-org/gitlab/-/merge_requests/42",
      expected: { host: "gitlab", webOrigin: "https://gitlab.com", projectPath: "gitlab-org/gitlab", number: 42 },
    },
    {
      input: "https://gitlab.acme.io/group/sub/project/-/merge_requests/9/diffs",
      expected: { host: "gitlab", webOrigin: "https://gitlab.acme.io", projectPath: "group/sub/project", number: 9 },
    },
  ])("parses $input", ({ input, expected }) => {
    expect(parsePullRequestUrl(input)).toEqual(expected)
  })

  it.each([
    "not a url",
    "ftp://github.com/a/b/pull/1",
    "https://github.com/a/b/issues/1",
    "https://github.com/a/b/pull/0",
    "https://github.com/a/b/pull/99999999999999999999",
    "https://gitlab.com/group/project/merge_requests/1",
  ])("rejects %s", (input) => {
    expect(() => parsePullRequestUrl(input)).toThrow(InvalidPullRequestUrlError)
  })
})
