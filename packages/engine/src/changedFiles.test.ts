import { chmod, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commitShaSchema } from "@walkdiff/review-model"
import type { CommitSha, FileDiff } from "@walkdiff/review-model"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { collectFileDiffs, PatchMismatchError, pairEntriesWithChunks } from "./changedFiles.ts"
import { runGit } from "./git.ts"

const COMMITTER_ENV = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
}
const RENAMED_BODY = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n")

describe("collectFileDiffs", () => {
  let repoDir = ""
  let files: FileDiff[] = []

  const git = (...args: string[]): Promise<string> => runGit(args, { cwd: repoDir, env: COMMITTER_ENV })
  const commit = async (message: string): Promise<CommitSha> => {
    await git("add", "--all")
    await git("commit", "--quiet", "--message", message)
    return commitShaSchema.parse((await git("rev-parse", "HEAD")).trim())
  }
  const file = (path: string): FileDiff | undefined => files.find((changed) => changed.path === path)

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "walkdiff-engine-"))
    await git("init", "--quiet")
    await writeFile(join(repoDir, "edited.ts"), "const a = 1\nconst b = 2\n")
    await writeFile(join(repoDir, "deleted.py"), "print('bye')\n")
    await writeFile(join(repoDir, "old name.rs"), `${RENAMED_BODY}\n`)
    await writeFile(join(repoDir, "becomes-link"), "plain file\n")
    await writeFile(join(repoDir, "script.sh"), "echo hi\n")
    const base = await commit("base")

    await writeFile(join(repoDir, "edited.ts"), "const a = 1\nconst b = 3\n")
    await unlink(join(repoDir, "deleted.py"))
    await git("mv", "old name.rs", "new name.rs")
    await writeFile(join(repoDir, "new name.rs"), `${RENAMED_BODY}\nline 20\n`)
    await writeFile(join(repoDir, "added.md"), "# hello\n")
    await writeFile(join(repoDir, "image.bin"), Buffer.from([0, 1, 2, 0, 255]))
    await unlink(join(repoDir, "becomes-link"))
    await symlink("edited.ts", join(repoDir, "becomes-link"))
    await chmod(join(repoDir, "script.sh"), 0o755)
    const head = await commit("head")

    files = await collectFileDiffs(repoDir, base, head)
  })

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true })
  })

  it("reports every changed path once", () => {
    expect(files.map((changed) => changed.path).sort()).toEqual(
      ["added.md", "becomes-link", "deleted.py", "edited.ts", "image.bin", "new name.rs", "script.sh"].sort(),
    )
  })

  it("parses an edit into hunks with line counts", () => {
    expect(file("edited.ts")).toMatchObject({ status: "modified", additions: 1, deletions: 1 })
  })

  it("detects a rename with edits and keeps the old path", () => {
    expect(file("new name.rs")).toMatchObject({ status: "renamed", previousPath: "old name.rs", additions: 1, deletions: 0 })
  })

  it("reports additions, deletions and binary files", () => {
    expect(file("added.md")).toMatchObject({ status: "added", additions: 1 })
    expect(file("deleted.py")).toMatchObject({ status: "deleted", deletions: 1 })
    expect(file("image.bin")).toMatchObject({ status: "added", content: { kind: "binary" } })
  })

  it("merges the two patch sections of a type change into one modified file", () => {
    expect(file("becomes-link")).toMatchObject({ status: "modified", additions: 1, deletions: 1 })
  })

  it("keeps a mode-only change as a modified file without hunks", () => {
    expect(file("script.sh")).toMatchObject({ status: "modified", content: { kind: "text", hunks: [] } })
  })
})

describe("collectFileDiffs under unusual user git config", () => {
  let repoDir = ""
  const savedEnv = { ...process.env }

  afterAll(async () => {
    process.env = savedEnv
    await rm(repoDir, { recursive: true, force: true })
  })

  it("keeps submodule sections and blank context lines that config would alter", async () => {
    repoDir = await mkdtemp(join(tmpdir(), "walkdiff-config-"))
    const git = (...args: string[]): Promise<string> => runGit(args, { cwd: repoDir, env: COMMITTER_ENV })
    // No --all: the gitlink has no working-tree entry, so --all would stage it as deleted.
    const commit = async (): Promise<CommitSha> => {
      await git("add", "a.txt")
      await git("commit", "--quiet", "--message", "change")
      return commitShaSchema.parse((await git("rev-parse", "HEAD")).trim())
    }
    await git("init", "--quiet")
    await writeFile(join(repoDir, "a.txt"), "one\n\nthree\n")
    // A submodule pointer needs no submodule checkout: it is just a gitlink entry.
    await git("update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},vendor/lib`)
    const base = await commit()
    await writeFile(join(repoDir, "a.txt"), "one\n\nTHREE\n")
    await git("update-index", "--cacheinfo", `160000,${"2".repeat(40)},vendor/lib`)
    const head = await commit()

    // The config that broke a rust-lang/rust PR, plus one that rewrites blank lines.
    process.env.GIT_CONFIG_COUNT = "2"
    process.env.GIT_CONFIG_KEY_0 = "diff.submodule"
    process.env.GIT_CONFIG_VALUE_0 = "log"
    process.env.GIT_CONFIG_KEY_1 = "diff.suppressBlankEmpty"
    process.env.GIT_CONFIG_VALUE_1 = "true"

    const diffs = await collectFileDiffs(repoDir, base, head)
    expect(diffs.map((diff) => diff.path)).toEqual(["a.txt", "vendor/lib"])
    const text = diffs.at(0)?.content
    expect(text?.kind === "text" ? text.hunks.at(0)?.lines.at(1) : undefined).toEqual({
      kind: "context",
      content: "",
      oldLine: 2,
      newLine: 2,
    })
  })
})

describe("pairEntriesWithChunks", () => {
  it("rejects a patch with more sections than the file list", () => {
    expect(() => pairEntriesWithChunks([], [["diff --git a/x b/x"]])).toThrow(PatchMismatchError)
  })

  it("rejects a patch with fewer sections than the file list", () => {
    expect(() => pairEntriesWithChunks([{ status: "typeChanged", path: "x" }], [["diff --git a/x b/x"]])).toThrow(
      PatchMismatchError,
    )
  })
})
