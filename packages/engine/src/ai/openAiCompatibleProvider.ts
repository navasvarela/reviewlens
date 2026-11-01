import { aiDestination, AiProviderKind } from "@walkdiff/review-model"
import type { AiDestination } from "@walkdiff/review-model"
import { z } from "zod"
import { rawAiOutputSchema } from "./output.ts"
import { AiUnavailableError } from "./provider.ts"
import type { AiCompletion, AiProvider } from "./provider.ts"

export const AI_API_KEY_VARIABLE = "WALKDIFF_AI_API_KEY"
// A local model on a laptop can take many minutes on a large prompt.
const COMPLETION_TIMEOUT_MS = 15 * 60 * 1000
const CONNECTION_TIMEOUT_MS = 10 * 1000
const MAX_ERROR_CHARS = 200
const LENGTH_FINISH_REASON = "length"

const completionSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({ finish_reason: z.string().nullable().optional(), message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).optional(),
})

export interface OpenAiCompatibleOptions {
  readonly model: string
  readonly baseUrl: string
  readonly apiKey: string | undefined
}

/**
 * Speaks the chat completions API that OpenAI, many hosted services and local servers such as
 * Ollama share. Uses `fetch` rather than a vendor's SDK because the point is to reach any of them.
 * Redirects are refused, because following one would send the code and key to another host.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly model: string
  readonly destination: AiDestination
  readonly #baseUrl: string
  readonly #apiKey: string | undefined

  constructor(options: OpenAiCompatibleOptions) {
    this.model = options.model
    this.#baseUrl = withoutTrailingSlashes(options.baseUrl)
    this.#apiKey = options.apiKey
    this.destination = aiDestination({ provider: AiProviderKind.OpenAiCompatible, model: options.model, baseUrl: options.baseUrl, maxInputTokens: 1, enabledByDefault: false })
  }

  async complete(system: string, prompt: string): Promise<AiCompletion> {
    const response = await this.#request("/chat/completions", COMPLETION_TIMEOUT_MS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_schema", json_schema: { name: "review", schema: z.toJSONSchema(rawAiOutputSchema) } },
      }),
    })
    const completion = completionSchema.safeParse(await readJson(response))
    if (!completion.success) throw new AiUnavailableError(`${this.destination.label} sent a response in an unexpected format`)
    const choice = completion.data.choices.at(0)
    if (choice?.finish_reason === LENGTH_FINISH_REASON) throw new AiUnavailableError("the response hit the model's length limit and was cut off")
    return {
      output: parseOutput(choice?.message.content ?? null),
      model: completion.data.model ?? this.model,
      usage: { inputTokens: completion.data.usage?.prompt_tokens ?? 0, outputTokens: completion.data.usage?.completion_tokens ?? 0 },
    }
  }

  /** Lists models, which sends no code. Not every compatible server offers this. */
  async checkConnection(): Promise<void> {
    await this.#request("/models", CONNECTION_TIMEOUT_MS, { method: "GET" })
  }

  async #request(path: string, timeoutMs: number, init: RequestInit): Promise<Response> {
    const headers = { ...init.headers, ...(this.#apiKey === undefined ? {} : { Authorization: `Bearer ${this.#apiKey}` }) }
    let response: Response
    try {
      response = await fetch(`${this.#baseUrl}${path}`, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs) })
    } catch (error: unknown) {
      throw new AiUnavailableError(`could not reach ${this.destination.label}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, MAX_ERROR_CHARS)
      throw new AiUnavailableError(`${this.destination.label} answered ${response.status}${response.status === 401 ? `; check ${AI_API_KEY_VARIABLE}` : ""}: ${detail}`)
    }
    return response
  }
}

// A loop rather than /\/+$/, whose backtracking gets slow on a long run of slashes mid-string.
function withoutTrailingSlashes(url: string): string {
  let end = url.length
  while (end > 0 && url[end - 1] === "/") end--
  return url.slice(0, end)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new AiUnavailableError("the provider's response wasn't valid JSON")
  }
}

function parseOutput(content: string | null): z.infer<typeof rawAiOutputSchema> {
  let json: unknown
  try {
    json = JSON.parse(content ?? "")
  } catch {
    throw new AiUnavailableError("the response did not match the expected review format")
  }
  const parsed = rawAiOutputSchema.safeParse(json)
  if (!parsed.success) throw new AiUnavailableError("the response did not match the expected review format")
  return parsed.data
}
