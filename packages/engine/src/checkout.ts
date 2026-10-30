import { access, mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { CommitSha } from "@lens/review-model"
import { gitSucceeds, runGit } from "./git.ts"

/** Credentials for git's HTTP transport, sent as Basic auth. */
export interface GitCredentials {
  readonly username: string
  readonly token: string
}

export interface FetchCommitsRequest {
  readonly cacheDir: string
  readonly cloneUrl: string
  readonly credentials: GitCredentials | undefined
  readonly commits: readonly CommitSha[]
}

export class MissingCommitsError extends Error {
  override readonly name = "MissingCommitsError"

  constructor(commits: readonly CommitSha[], cloneUrl: string) {
    super(`${cloneUrl} did not provide ${commits.join(", ")}; the branch may have been force-pushed.`)
  }
}

/**
 * Makes the given commits available in a cached bare repository and returns its path.
 *
 * Only the commits themselves are fetched (depth 1), not their history: a diff needs
 * just the two trees, and the merge base already comes from the host's API. This keeps
 * the first run on a large monorepo to two snapshots instead of a full clone.
 */
export async function fetchCommits(request: FetchCommitsRequest): Promise<string> {
  const repoDir = repositoryCacheDir(request.cacheDir, request.cloneUrl)
  await ensureBareRepository(repoDir)

  const missing = await missingCommits(repoDir, request.commits)
  if (missing.length === 0) {
    return repoDir
  }

  // Each commit gets its own ref so `git gc` never prunes it as unreachable.
  const refspecs = missing.map((sha) => `${sha}:refs/lens/commits/${sha}`)
  await runGit(["fetch", "--no-tags", "--quiet", "--depth=1", request.cloneUrl, ...refspecs], {
    cwd: repoDir,
    env: credentialEnv(request.credentials),
  })

  const stillMissing = await missingCommits(repoDir, missing)
  if (stillMissing.length > 0) {
    throw new MissingCommitsError(stillMissing, request.cloneUrl)
  }
  return repoDir
}

function repositoryCacheDir(cacheDir: string, cloneUrl: string): string {
  const url = new URL(cloneUrl)
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0)
  return join(cacheDir, "repos", url.host, ...segments)
}

async function ensureBareRepository(repoDir: string): Promise<void> {
  if (await exists(join(repoDir, "HEAD"))) {
    return
  }
  await mkdir(repoDir, { recursive: true })
  await runGit(["init", "--bare", "--quiet"], { cwd: repoDir })
}

async function missingCommits(repoDir: string, commits: readonly CommitSha[]): Promise<CommitSha[]> {
  const present = await Promise.all(
    commits.map((sha) => gitSucceeds(["cat-file", "-e", `${sha}^{commit}`], { cwd: repoDir })),
  )
  return commits.filter((_, index) => present.at(index) !== true)
}

// The header travels through GIT_CONFIG_* variables rather than `-c` arguments or the
// remote URL, which keeps the token out of `ps` output and out of the repository's config.
function credentialEnv(credentials: GitCredentials | undefined): Record<string, string> {
  if (credentials === undefined) {
    return {}
  }
  const basic = Buffer.from(`${credentials.username}:${credentials.token}`).toString("base64")
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
