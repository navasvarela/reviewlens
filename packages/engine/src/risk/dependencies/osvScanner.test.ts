import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commitShaSchema } from "@walkdiff/review-model"
import type { CommitSha, FileDiff } from "@walkdiff/review-model"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runGit } from "../../git.ts"
import type { ScannerProcessRunner } from "../scanners/scannerProcess.ts"
import { scanUnreadLockfiles } from "./osvScanner.ts"

const COMMITTER_ENV = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
}
const LOCKFILE = "pnpm-lock.yaml"
const LOCKFILE_DIFF: FileDiff = { status: "modified", path: LOCKFILE, additions: 1, deletions: 0, content: { kind: "text", hunks: [] } }

const advisory = (id: string, version: string): object => ({ package: { name: "left-pad", version, ecosystem: "npm" }, vulnerabilities: [{ id }] })

/** Reports an advisory per version, reading which lockfile version it was given. */
const fakeOsvScanner: ScannerProcessRunner = async (_binary, _args, cwd) => {
  const text = await readFile(join(cwd, LOCKFILE), "utf8")
  const packages = text.includes("v2") ? [advisory("OLD", "1.0.0"), advisory("NEW", "2.0.0")] : [advisory("OLD", "1.0.0")]
  return { exitCode: 1, stdout: JSON.stringify({ results: [{ packages }] }), stderr: "" }
}

describe("scanUnreadLockfiles", () => {
  let repoDir = ""
  let base: CommitSha
  let head: CommitSha

  const git = (...args: string[]): Promise<string> => runGit(args, { cwd: repoDir, env: COMMITTER_ENV })
  const commitLockfile = async (content: string): Promise<CommitSha> => {
    await writeFile(join(repoDir, LOCKFILE), content)
    await git("add", "--all")
    await git("commit", "--quiet", "--message", "change")
    return commitShaSchema.parse((await git("rev-parse", "HEAD")).trim())
  }
  const scan = (network: boolean, runScanner: ScannerProcessRunner) => scanUnreadLockfiles([LOCKFILE_DIFF], { repoDir, base, head, network, runScanner })

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "walkdiff-osv-test-"))
    await git("init", "--quiet")
    base = await commitLockfile("v1\n")
    head = await commitLockfile("v2\n")
  })
  afterAll(() => rm(repoDir, { recursive: true, force: true }))

  it("reports only vulnerabilities the PR introduced", async () => {
    const { vulnerable, checksRun, notChecked } = await scan(true, fakeOsvScanner)
    expect(vulnerable.map((entry) => entry.found.vulnerability.id)).toEqual(["NEW"])
    expect(checksRun.map((check) => check.name)).toEqual(["osv-scanner"])
    expect(notChecked).toEqual([])
  })

  it.each([
    ["offline", false, fakeOsvScanner, "offline"],
    ["not installed", true, async () => undefined, "brew install osv-scanner"],
    ["failing", true, async () => ({ exitCode: 127, stdout: "", stderr: "boom" }), "boom"],
    ["unreadable", true, async () => ({ exitCode: 0, stdout: "not json", stderr: "" }), "osv-scanner failed"],
  ] satisfies [string, boolean, ScannerProcessRunner, string][])("lists the lockfile as not checked when %s", async (_name, network, runner, reason) => {
    const { vulnerable, notChecked } = await scan(network, runner)
    expect(vulnerable).toEqual([])
    expect(notChecked.at(0)?.reason).toContain(reason)
  })
})
