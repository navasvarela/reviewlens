import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { commitShaSchema } from "@lens/review-model"
import type { CommitSha, RiskAssessment } from "@lens/review-model"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { analyzeChangedFiles } from "../analyzeChangedFiles.ts"
import { runGit } from "../git.ts"

const COMMITTER_ENV = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
}

describe("assessRisk", () => {
  let repoDir = ""
  let risk: RiskAssessment | undefined

  const git = (...args: string[]): Promise<string> => runGit(args, { cwd: repoDir, env: COMMITTER_ENV })
  const write = async (path: string, content: string): Promise<void> => {
    await mkdir(dirname(join(repoDir, path)), { recursive: true })
    await writeFile(join(repoDir, path), content)
  }
  const commit = async (): Promise<CommitSha> => {
    await git("add", "--all")
    await git("commit", "--quiet", "--message", "change")
    return commitShaSchema.parse((await git("rev-parse", "HEAD")).trim())
  }
  const ruleIds = (): string[] => (risk?.findings ?? []).map((finding) => finding.ruleId)

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "lens-risk-"))
    await git("init", "--quiet")
    await write("src/util.py", "def parse(text):\n    return int(text)\n\ndef keep():\n    return 1\n")
    await write("src/app.py", "from util import parse\n\ndef run(raw):\n    return parse(raw)\n")
    await write("package.json", '{"dependencies":{"react":"^19.0.0"}}\n')
    await write("package-lock.json", JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }))
    await write(
      ".lens.json",
      JSON.stringify({ riskPaths: [{ pattern: "src/ledger/**", severity: "high", reason: "Moves customer funds" }], ignore: ["fixtures/**"] }),
    )
    const base = await commit()

    // The PR tries to silence every rule on itself.
    await write(".lens.json", JSON.stringify({ ignore: ["**"] }))
    await write("src/util.py", "def keep():\n    return 2\n")
    await write("src/ledger/post.py", "import subprocess\n\ndef post(cmd):\n    subprocess.run(cmd, shell=True)\n")
    await write("fixtures/keys.txt", "-----BEGIN PRIVATE KEY-----\n")
    await write("package.json", '{"dependencies":{"react":"^19.0.0","left-pad":"^1.3.0"}}\n')
    await write(
      "package-lock.json",
      JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/left-pad": { version: "1.3.0" } } }),
    )
    const head = await commit()

    risk = (await analyzeChangedFiles(repoDir, base, head, { network: false })).risk
  })

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true })
  })

  it("rates the security level from the most severe security finding", () => {
    expect(risk?.securityLevel).toBe("high")
  })

  it("judges the PR by the rules at its merge base and flags its edit to them", () => {
    expect(ruleIds()).toEqual([
      "config.src/ledger/**",
      "python.subprocess-shell",
      "reference.stale",
      "path.lens-config",
      "tests.none",
      "dependency.added",
    ])
    expect(risk?.findings.find((finding) => finding.ruleId === "reference.stale")?.location).toEqual({ path: "src/app.py", line: 1 })
    expect(risk?.findings.find((finding) => finding.ruleId === "dependency.added")?.location).toEqual({ path: "package.json", line: 1 })
  })

  it("leaves ignored paths out and says so, along with checks that did not run", () => {
    expect(ruleIds()).not.toContain("secret.private-key")
    expect(risk?.notChecked.map((skipped) => skipped.check)).toEqual([
      "Known vulnerabilities in new dependency versions",
      "Risk rules on 1 file",
      "Third-party scanners (Semgrep, gitleaks, osv-scanner)",
      "Change history (frequently changed or bug-prone files)",
    ])
  })
})
