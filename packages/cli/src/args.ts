import { parseArgs } from "node:util"

export const USAGE = `Usage:
  lens review [pull-request-url] [options]
  lens comment --report <dir> --report-url <url>
  lens app [options]

review analyzes a GitHub pull request or GitLab merge request and serves a local report.
In GitHub Actions or a GitLab merge request pipeline the URL comes from the environment.

comment posts or updates a summary on the pull request, linking to the report.

app runs a local page where you add pull requests and keep track of several reviews.

Options:
  --out <dir>        Write the report here instead of the cache directory
  --port <number>    Port for the local server (review: a free port; app: 4317)
  --no-serve         Write the report and exit without serving it
  --offline          Skip network checks (dependency vulnerability lookups in OSV)
  --ai               Add an AI review (reading order, intent check, questions); sends the
                     changed code to the model provider. Off by default.
  --ai-model <id>    Model for --ai (default: claude-opus-5-5)
  --ai-max-input-tokens <n>
                     Prompt budget for --ai (default: 40000); larger PRs are summarized
  --cache-dir <dir>  Where repositories and reports are cached (default: ~/.cache/lens)
  --data-dir <dir>   With app: where the review list is stored (default: ~/.local/share/lens)
  --report <dir>     With comment: the directory review wrote (--out)
  --report-url <url> With comment: where reviewers can open the report
  -h, --help         Show this help

Environment:
  GITHUB_TOKEN, GH_TOKEN   Token for GitHub (required for private repositories)
  GITLAB_TOKEN             Token for GitLab (required for private projects)
  LENS_TRUSTED_GITHUB_HOSTS, LENS_TRUSTED_GITLAB_HOSTS
                           Comma-separated hosts besides github.com and gitlab.com that
                           may receive those tokens, such as git.acme.internal
  ANTHROPIC_API_KEY        Credential for --ai (or an \`ant auth login\` profile)

Troubleshooting: https://github.com/navasvarela/reviewlens/blob/main/docs/troubleshooting.md`

const MAX_PORT = 65_535
// About $0.16 of input on Claude Opus 5.5; enough for the full text of most PRs' changed units.
export const DEFAULT_AI_MAX_INPUT_TOKENS = 40_000
export const DEFAULT_AI_MODEL = "claude-opus-5-5"
// Fixed so the list page has an address worth bookmarking.
const DEFAULT_APP_PORT = 4317

export interface ReviewOptions {
  /** Undefined means: take it from the CI environment. */
  readonly url: string | undefined
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

export interface CommentOptions {
  readonly reportDir: string
  readonly reportUrl: string
}

export interface AppOptions {
  readonly port: number
  readonly network: boolean
  readonly cacheDir: string | undefined
  readonly dataDir: string | undefined
}

export type Command =
  | { readonly kind: "help" }
  | { readonly kind: "app"; readonly options: AppOptions }
  | { readonly kind: "review"; readonly options: ReviewOptions }
  | { readonly kind: "comment"; readonly options: CommentOptions }

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
      "data-dir": { type: "string" },
      report: { type: "string" },
      "report-url": { type: "string" },
      "cache-dir": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  })

  const [command, url, ...extra] = positionals
  if (values.help || command === undefined) {
    return { kind: "help" }
  }
  if (command === "comment") {
    return { kind: "comment", options: parseCommentOptions(values.report, values["report-url"]) }
  }
  if (command === "app") {
    return {
      kind: "app",
      options: {
        port: values.port === undefined ? DEFAULT_APP_PORT : parsePort(values.port),
        network: !values.offline,
        cacheDir: values["cache-dir"],
        dataDir: values["data-dir"],
      },
    }
  }
  if (command !== "review") {
    throw new UsageError(`Unknown command "${command}"`)
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

function parseCommentOptions(reportDir: string | undefined, reportUrl: string | undefined): CommentOptions {
  if (reportDir === undefined || reportUrl === undefined) {
    throw new UsageError("comment needs both --report and --report-url")
  }
  if (!/^https?:\/\//.test(reportUrl)) {
    throw new UsageError(`--report-url must be an http or https URL, got "${reportUrl}"`)
  }
  return { reportDir, reportUrl }
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
