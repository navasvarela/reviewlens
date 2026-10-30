import { parseArgs } from "node:util"

export const USAGE = `Usage: lens review <pull-request-url> [options]

Analyzes a GitHub pull request or GitLab merge request and serves a local report.

Options:
  --out <dir>        Write the report here instead of the cache directory
  --port <number>    Port for the local report server (default: a free port)
  --no-serve         Write the report and exit without serving it
  --offline          Skip network checks (dependency vulnerability lookups in OSV)
  --ai               Add an AI review (reading order, intent check, questions); sends the
                     changed code to the model provider. Off by default.
  --ai-model <id>    Model for --ai (default: claude-opus-5-5)
  --ai-max-input-tokens <n>
                     Prompt budget for --ai (default: 40000); larger PRs are summarized
  --cache-dir <dir>  Where repositories and reports are cached (default: ~/.cache/lens)
  -h, --help         Show this help

Environment:
  GITHUB_TOKEN, GH_TOKEN   Token for GitHub (required for private repositories)
  GITLAB_TOKEN             Token for GitLab (required for private projects)
  ANTHROPIC_API_KEY        Credential for --ai (or an \`ant auth login\` profile)`

const MAX_PORT = 65_535
// About $0.16 of input on Claude Opus 5.5; enough for the full text of most PRs' changed units.
const DEFAULT_AI_MAX_INPUT_TOKENS = 40_000
const DEFAULT_AI_MODEL = "claude-opus-5-5"

export interface ReviewOptions {
  readonly url: string
  readonly outDir: string | undefined
  readonly port: number
  readonly serve: boolean
  readonly cacheDir: string | undefined
  /** False when --offline: no package names or versions leave the machine. */
  readonly network: boolean
  /** Undefined unless --ai: no code is sent to a model without it. */
  readonly ai: AiOptions | undefined
}

export interface AiOptions {
  readonly model: string
  readonly maxInputTokens: number
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
      ai: { type: "boolean", default: false },
      "ai-model": { type: "string" },
      "ai-max-input-tokens": { type: "string" },
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
      ai: values.ai
        ? {
            model: values["ai-model"] ?? DEFAULT_AI_MODEL,
            maxInputTokens:
              values["ai-max-input-tokens"] === undefined ? DEFAULT_AI_MAX_INPUT_TOKENS : parsePositiveInteger(values["ai-max-input-tokens"], "--ai-max-input-tokens"),
          }
        : undefined,
    },
  }
}

function parsePositiveInteger(text: string, flag: string): number {
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new UsageError(`${flag} needs a positive whole number, got "${text}"`)
  }
  return value
}

function parsePort(text: string): number {
  const port = Number(text)
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new UsageError(`Invalid port "${text}"`)
  }
  return port
}
