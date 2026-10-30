import { homedir } from "node:os"
import { join } from "node:path"
import type { HostTokens } from "@lens/providers"

type Environment = Readonly<Record<string, string | undefined>>

// TODO: fall back to `gh auth token` and `glab auth token` when no variable is set,
// so engineers who already use those CLIs need no extra setup.
export function readHostTokens(env: Environment): HostTokens {
  return {
    github: nonEmpty(env.GITHUB_TOKEN) ?? nonEmpty(env.GH_TOKEN),
    gitlab: nonEmpty(env.GITLAB_TOKEN),
  }
}

export function defaultCacheDir(env: Environment): string {
  const xdgCache = nonEmpty(env.XDG_CACHE_HOME)
  return join(xdgCache ?? join(homedir(), ".cache"), "lens")
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value
}
