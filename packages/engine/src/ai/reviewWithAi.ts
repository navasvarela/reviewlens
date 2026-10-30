import { AiReviewStatus } from "@lens/review-model"
import type { AiReview, CommitSha } from "@lens/review-model"
import { LENS_CONFIG_PATH, LensConfigError, readLensConfig } from "../config/lensConfig.ts"
import { completionCacheKey, readCachedCompletion, writeCachedCompletion } from "./cache.ts"
import { SYSTEM_PROMPT } from "./instructions.ts"
import { validateOutput } from "./output.ts"
import { buildPrompt } from "./prompt.ts"
import type { ReviewContext } from "./prompt.ts"
import { AiUnavailableError } from "./provider.ts"
import type { AiProvider, TokenUsage } from "./provider.ts"

export interface AiReviewRequest {
  readonly repoDir: string
  readonly base: CommitSha
  readonly head: CommitSha
  readonly context: ReviewContext
  readonly provider: AiProvider
  readonly cacheDir: string
  /** Upper bound on prompt size; units beyond it are listed by name only. */
  readonly maxInputTokens: number
}

interface PricePerMillionTokens {
  readonly input: number
  readonly output: number
}

// Anthropic list prices in USD per million tokens, as of 2026-10. Other models get no
// estimate rather than a wrong one.
const PRICES: ReadonlyMap<string, PricePerMillionTokens> = new Map([
  ["claude-opus-5-5", { input: 4, output: 20 }],
  ["claude-sonnet-5-5", { input: 2, output: 10 }],
  ["claude-haiku-5-5", { input: 0.1, output: 0.5 }],
])
const TOKENS_PER_MILLION = 1_000_000

/**
 * Asks the model for a reading order, an intent check and reviewer questions, then keeps
 * only statements whose citations match the change. Never runs when the repository's
 * config forbids sending its code to a model.
 */
export async function reviewWithAi(request: AiReviewRequest): Promise<AiReview> {
  if (!(await isAiAllowed(request.repoDir, request.base, request.head))) {
    return { status: AiReviewStatus.Unavailable, reason: `${LENS_CONFIG_PATH} forbids sending this repository's code to a model` }
  }

  const plan = buildPrompt(request.context, request.maxInputTokens)
  const key = completionCacheKey(request.provider.model, plan.text)
  const cachedCompletion = await readCachedCompletion(request.cacheDir, key)
  let completion = cachedCompletion
  if (completion === undefined) {
    try {
      completion = await request.provider.complete(SYSTEM_PROMPT, plan.text)
    } catch (error: unknown) {
      if (error instanceof AiUnavailableError) return { status: AiReviewStatus.Unavailable, reason: error.message }
      throw error
    }
    await writeCachedCompletion(request.cacheDir, key, completion)
  }

  return {
    status: AiReviewStatus.Completed,
    model: completion.model,
    ...validateOutput(completion.output, plan),
    unitsSummarizedOnly: plan.summarizedOnly,
    usage: completion.usage,
    estimatedCostUsd: estimateCost(completion.model, completion.usage),
    cached: cachedCompletion !== undefined,
  }
}

/**
 * Sending code is the one step that cannot be undone, so either version forbidding it is
 * enough, and a head config that cannot be read counts as forbidding.
 */
async function isAiAllowed(repoDir: string, base: CommitSha, head: CommitSha): Promise<boolean> {
  const baseConfig = await readLensConfig(repoDir, base)
  try {
    const headConfig = await readLensConfig(repoDir, head)
    return baseConfig.ai.allowed && headConfig.ai.allowed
  } catch (error: unknown) {
    if (error instanceof LensConfigError) return false
    throw error
  }
}

function estimateCost(model: string, usage: TokenUsage): number | null {
  const price = PRICES.get(model)
  if (price === undefined) return null
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / TOKENS_PER_MILLION
}
