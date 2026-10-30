import { parseArgs } from "node:util"

export const USAGE = `Usage: lens review <pull-request-url> [options]

Analyzes a GitHub pull request or GitLab merge request and serves a local report.

Options:
  --out <dir>        Write the report here instead of the cache directory
  --port <number>    Port for the local report server (default: a free port)
  --no-serve         Write the report and exit without serving it
  --offline          Skip network checks (dependency vulnerability lookups in OSV)
  --cache-dir <dir>  Where repositories and reports are cached (default: ~/.cache/lens)
  -h, --help         Show this help

Environment:
  GITHUB_TOKEN, GH_TOKEN   Token for GitHub (required for private repositories)
  GITLAB_TOKEN             Token for GitLab (required for private projects)`

const MAX_PORT = 65_535

export interface ReviewOptions {
  readonly url: string
  readonly outDir: string | undefined
  readonly port: number
  readonly serve: boolean
  readonly cacheDir: string | undefined
  /** False when --offline: no package names or versions leave the machine. */
  readonly network: boolean
}

export type Command = { readonly kind: "help" } | { readonly kind: "review"; readonly options: ReviewOptions }

export class UsageError extends Error {
  override readonly name = "UsageError"
}

export function parseCommand(argv: readonly string[]): Command {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    allowNegative: true,
    options: {
      out: { type: "string" },
      port: { type: "string" },
      serve: { type: "boolean", default: true },
      offline: { type: "boolean", default: false },
      "cache-dir": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  })

  const [command, url, ...extra] = positionals
  if (values.help || command === undefined) {
    return { kind: "help" }
  }
  if (command !== "review") {
    throw new UsageError(`Unknown command "${command}"`)
  }
  if (url === undefined) {
    throw new UsageError("Missing the pull request URL")
  }
  if (extra.length > 0) {
    throw new UsageError(`Unexpected arguments: ${extra.join(" ")}`)
  }

  return {
    kind: "review",
    options: {
      url,
      outDir: values.out,
      port: values.port === undefined ? 0 : parsePort(values.port),
      serve: values.serve,
      cacheDir: values["cache-dir"],
      network: !values.offline,
    },
  }
}

function parsePort(text: string): number {
  const port = Number(text)
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new UsageError(`Invalid port "${text}"`)
  }
  return port
}
