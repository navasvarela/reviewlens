import { AiReviewStatus } from "@walkdiff/review-model"
import type { AiDestination, AiReview, CommitSha } from "@walkdiff/review-model"
import { WALKDIFF_CONFIG_PATH, WalkdiffConfigError, readWalkdiffConfig } from "../config/walkdiffConfig.ts"
import type { WalkdiffConfig } from "../config/walkdiffConfig.ts"
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
  const refusal = await aiRefusal(request)
  if (refusal !== undefined) return { status: AiReviewStatus.Unavailable, reason: refusal }

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
async function aiRefusal(request: AiReviewRequest): Promise<string | undefined> {
  const forbidden = `${WALKDIFF_CONFIG_PATH} forbids sending this repository's code to a model`
  const base = await readWalkdiffConfig(request.repoDir, request.base)
  let head: WalkdiffConfig
  try {
    head = await readWalkdiffConfig(request.repoDir, request.head)
  } catch (error: unknown) {
    if (error instanceof WalkdiffConfigError) return forbidden
    throw error
  }
  if (!base.ai.allowed || !head.ai.allowed) return forbidden
  const limit = [base, head].find((config) => !allowsDestination(config, request.provider.destination))
  return limit === undefined ? undefined : `${WALKDIFF_CONFIG_PATH} only allows AI review with: ${(limit.ai.providers ?? []).join(", ")}. This repository's code wasn't sent to ${request.provider.destination.label}`
}

function allowsDestination(config: WalkdiffConfig, destination: AiDestination): boolean {
  return config.ai.providers === null || config.ai.providers.some((allowed) => destination.ids.includes(allowed))
}

function estimateCost(model: string, usage: TokenUsage): number | null {
  const price = PRICES.get(model)
  if (price === undefined) return null
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / TOKENS_PER_MILLION
}
