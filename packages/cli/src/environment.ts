import { execFile } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { HostTokens } from "@lens/providers"

type Environment = Readonly<Record<string, string | undefined>>

export function readHostTokens(env: Environment): HostTokens {
  return {
    github: nonEmpty(env.GITHUB_TOKEN) ?? nonEmpty(env.GH_TOKEN),
    gitlab: nonEmpty(env.GITLAB_TOKEN),
  }
}

/** Runs a command and gives its output, or undefined if it is missing or fails. */
export type CommandRunner = (command: string, args: readonly string[]) => Promise<string | undefined>

const CREDENTIAL_COMMAND_TIMEOUT_MS = 5_000

export const runCommand: CommandRunner = async (command, args) => {
  try {
    const { stdout } = await promisify(execFile)(command, [...args], { timeout: CREDENTIAL_COMMAND_TIMEOUT_MS })
    return stdout
  } catch {
    return undefined
  }
}

/**
 * Tokens for one host: the environment first, then the GitHub CLI's login, so engineers
 * already signed in need no setup. `gh` is asked by hostname, so its token for one host is
 * never sent to another. No such lookup is used for GitLab: only the variable is read.
 */
export async function hostTokensFor(webOrigin: string, env: Environment, run: CommandRunner): Promise<HostTokens> {
  const tokens = readHostTokens(env)
  if (tokens.github !== undefined) return tokens
  const output = await run("gh", ["auth", "token", "--hostname", new URL(webOrigin).host])
  return { ...tokens, github: nonEmpty(output?.trim()) }
}

export function defaultDataDir(env: Environment): string {
  const xdgData = nonEmpty(env.XDG_DATA_HOME)
  return join(xdgData ?? join(homedir(), ".local", "share"), "lens")
}

export function defaultCacheDir(env: Environment): string {
  const xdgCache = nonEmpty(env.XDG_CACHE_HOME)
  return join(xdgCache ?? join(homedir(), ".cache"), "lens")
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value
}
