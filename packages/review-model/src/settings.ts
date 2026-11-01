import { z } from "zod"

/** The optional checks a person can turn off. Built-in secret and risky API rules aren't among them. */
export const CheckId = {
  Semgrep: "semgrep",
  Gitleaks: "gitleaks",
  OsvScanner: "osvScanner",
  OsvDatabase: "osvDatabase",
  Ruff: "ruff",
  Oxlint: "oxlint",
  Jscpd: "jscpd",
  FunctionMetrics: "functionMetrics",
} as const
export type CheckId = (typeof CheckId)[keyof typeof CheckId]

export const AiProviderKind = { Anthropic: "anthropic", OpenAiCompatible: "openaiCompatible" } as const
export type AiProviderKind = (typeof AiProviderKind)[keyof typeof AiProviderKind]

export const DEFAULT_AI_MODEL = "claude-opus-5-5"
// About $0.16 of input on Claude Opus 5.5; enough for the full text of most PRs' changed units.
export const DEFAULT_AI_MAX_INPUT_TOKENS = 40_000

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"])

export function isLoopbackUrl(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname)
}

/** Why a provider's address can't be used, or undefined when it can. */
export function baseUrlProblem(text: string): string | undefined {
  if (!URL.canParse(text)) return "Enter a full address, such as https://api.example.com/v1"
  const url = new URL(text)
  if (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackUrl(url))) return undefined
  return "Use https, because this address receives your code and API key. Plain http only works for a model on this machine"
}

export const aiSettingsSchema = z
  .object({
    provider: z.enum(AiProviderKind),
    model: z.string().trim().min(1, "Enter a model name"),
    /** Only for an OpenAI-compatible provider. */
    baseUrl: z.string().nullable(),
    maxInputTokens: z.number().int().positive(),
    enabledByDefault: z.boolean(),
  })
  .superRefine((ai, context) => {
    if (ai.provider !== AiProviderKind.OpenAiCompatible) return
    const problem = ai.baseUrl === null ? "Enter the provider's address" : baseUrlProblem(ai.baseUrl)
    if (problem !== undefined) context.addIssue({ code: "custom", path: ["baseUrl"], message: problem })
  })
export type AiSettings = z.infer<typeof aiSettingsSchema>

/** A person's own preferences. API keys are deliberately not here: they come from the environment. */
export const appSettingsSchema = z.object({
  disabledChecks: z.array(z.enum(CheckId)).readonly(),
  ai: aiSettingsSchema,
})
export type AppSettings = z.infer<typeof appSettingsSchema>

export const DEFAULT_APP_SETTINGS: AppSettings = {
  disabledChecks: [],
  ai: { provider: AiProviderKind.Anthropic, model: DEFAULT_AI_MODEL, baseUrl: null, maxInputTokens: DEFAULT_AI_MAX_INPUT_TOKENS, enabledByDefault: false },
}

export const LOCAL_AI_DESTINATION = "local"

/** Where AI review would send code: words for people, and names a team's rules can match. */
export interface AiDestination {
  readonly label: string
  readonly isLocal: boolean
  readonly ids: readonly string[]
}

export function aiDestination(ai: AiSettings): AiDestination {
  if (ai.provider === AiProviderKind.Anthropic || ai.baseUrl === null) return { label: "Anthropic", isLocal: false, ids: [AiProviderKind.Anthropic] }
  const url = new URL(ai.baseUrl)
  return isLoopbackUrl(url) ? { label: "a model on this machine", isLocal: true, ids: [url.host, LOCAL_AI_DESTINATION] } : { label: url.host, isLocal: false, ids: [url.host] }
}

/** What the settings page needs to know about one check. */
export const checkStatusSchema = z.object({
  id: z.enum(CheckId),
  name: z.string(),
  purpose: z.string(),
  /** Null for checks with nothing to install. */
  installed: z.boolean().nullable(),
  install: z.string().nullable(),
  /** What it sends and where; null when it stays on this machine. */
  sends: z.string().nullable(),
})
export type CheckStatus = z.infer<typeof checkStatusSchema>

export const settingsViewSchema = z.object({
  settings: appSettingsSchema,
  checks: z.array(checkStatusSchema).readonly(),
  /** Whether a key is available, never the key itself. */
  aiKeys: z.object({ anthropic: z.boolean(), openaiCompatible: z.boolean() }),
  /** True when the app was started with --offline. */
  offline: z.boolean(),
})
export type SettingsView = z.infer<typeof settingsViewSchema>

export const aiConnectionResultSchema = z.object({ ok: z.boolean(), message: z.string() })
export type AiConnectionResult = z.infer<typeof aiConnectionResultSchema>
