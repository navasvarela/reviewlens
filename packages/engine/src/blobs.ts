import { spawn } from "node:child_process"
import type { CommitSha } from "@lens/review-model"
import { GitCommandError } from "./git.ts"

export interface BlobRequest {
  readonly commit: CommitSha
  readonly path: string
}

const NEWLINE = 0x0a

/**
 * Reads many files at given commits through one `git cat-file --batch` process.
 * Returns contents in request order; `undefined` marks a file that does not exist
 * at that commit, or whose path contains a newline (the batch protocol is
 * line-delimited, so such paths cannot be requested).
 */
export async function readBlobs(repoDir: string, requests: readonly BlobRequest[]): Promise<(Buffer | undefined)[]> {
  const requestable = requests.map((request) => !request.path.includes("\n"))
  const input = requests
    .filter((_, index) => requestable.at(index))
    .map((request) => `${request.commit}:${request.path}\n`)
    .join("")
  if (input === "") {
    return requests.map(() => undefined)
  }

  const output = await runCatFileBatch(repoDir, input)
  const blobs = parseBatchOutput(output)
  return requestable.map((canRequest) => (canRequest ? blobs.shift() : undefined))
}

function runCatFileBatch(repoDir: string, input: string): Promise<Buffer> {
  const args = ["cat-file", "--batch"]
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: repoDir, stdio: ["pipe", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.on("error", (error) => reject(new GitCommandError(args, "", error)))
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout))
      } else {
        reject(new GitCommandError(args, Buffer.concat(stderr).toString("utf8"), `exit code ${code}`))
      }
    })
    child.stdin.end(input)
  })
}

/**
 * Each object comes back as `<oid> <type> <size>\n<content>\n`; a missing one as
 * `<name> missing\n`. Sizes are in bytes, so the output is walked as a Buffer.
 */
export function parseBatchOutput(output: Buffer): (Buffer | undefined)[] {
  const blobs: (Buffer | undefined)[] = []
  let cursor = 0
  while (cursor < output.length) {
    const headerEnd = output.indexOf(NEWLINE, cursor)
    if (headerEnd === -1) {
      throw new GitCommandError(["cat-file", "--batch"], "", "truncated output")
    }
    const header = output.toString("utf8", cursor, headerEnd)
    cursor = headerEnd + 1
    const size = objectSize(header)
    if (size === undefined) {
      blobs.push(undefined)
      continue
    }
    blobs.push(output.subarray(cursor, cursor + size))
    cursor += size + 1
  }
  return blobs
}

const OBJECT_HEADER = /^[0-9a-f]+ \w+ (\d+)$/

function objectSize(header: string): number | undefined {
  const size = OBJECT_HEADER.exec(header)?.at(1)
  return size === undefined ? undefined : Number(size)
}
