import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

// Patches for PRs that touch vendored code or lockfiles can reach hundreds of megabytes;
// execFile's 1 MB default would fail them.
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024 * 1024

/**
 * Environment for git commands whose output is parsed. User and system config can change
 * that output: `diff.submodule=log` drops the `diff --git` header of submodule changes, and
 * `diff.suppressBlankEmpty` turns blank context lines into empty ones. Fetches keep the
 * user's config, which may hold proxies and credential helpers.
 */
export const ISOLATED_CONFIG_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_COUNT: "0",
}

export class GitCommandError extends Error {
  override readonly name = "GitCommandError"
  readonly args: readonly string[]
  readonly stderr: string
  /** Undefined when git could not be started at all. */
  readonly exitCode: number | undefined

  constructor(args: readonly string[], stderr: string, cause: unknown) {
    super(`git ${args[0] ?? ""} failed: ${stderr.trim() || String(cause)}`, { cause })
    this.args = args
    this.stderr = stderr
    this.exitCode = exitCodeOf(cause)
  }
}

export interface GitInvocation {
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
}

export async function runGit(args: readonly string[], invocation: GitInvocation): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: invocation.cwd,
      // Never block on a credential prompt: walkdiff runs unattended in CI.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...invocation.env },
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      encoding: "utf8",
    })
    return stdout
  } catch (error: unknown) {
    throw new GitCommandError(args, stderrOf(error), error)
  }
}

/** For git commands whose exit status is the answer, such as `cat-file -e`. */
export async function gitSucceeds(args: readonly string[], invocation: GitInvocation): Promise<boolean> {
  try {
    await runGit(args, invocation)
    return true
  } catch (error: unknown) {
    if (error instanceof GitCommandError) {
      return false
    }
    throw error
  }
}

function stderrOf(error: unknown): string {
  if (error instanceof Error && "stderr" in error && typeof error.stderr === "string") {
    return error.stderr
  }
  return ""
}

function exitCodeOf(error: unknown): number | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "number") {
    return error.code
  }
  return undefined
}
