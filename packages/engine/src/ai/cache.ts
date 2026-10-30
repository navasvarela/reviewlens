import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { PROMPT_VERSION } from "./instructions.ts"
import { rawAiOutputSchema } from "./output.ts"
import type { AiCompletion } from "./provider.ts"

const cachedCompletionSchema = z.object({
  output: rawAiOutputSchema,
  model: z.string(),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
})

/**
 * Keyed by everything that shapes the answer: the instructions' version, the model, and
 * the full prompt (which embeds the head commit's code), so any change misses the cache.
 */
export function completionCacheKey(model: string, prompt: string): string {
  return createHash("sha256").update(`${PROMPT_VERSION}\0${model}\0${prompt}`).digest("hex")
}

export async function readCachedCompletion(cacheDir: string, key: string): Promise<AiCompletion | undefined> {
  let text: string
  try {
    text = await readFile(cachePath(cacheDir, key), "utf8")
  } catch {
    return undefined
  }
  // A corrupt or outdated entry is treated as a miss and overwritten by the next run.
  const result = cachedCompletionSchema.safeParse(safeJson(text))
  return result.success ? result.data : undefined
}

export async function writeCachedCompletion(cacheDir: string, key: string, completion: AiCompletion): Promise<void> {
  await mkdir(join(cacheDir, "ai"), { recursive: true })
  await writeFile(cachePath(cacheDir, key), JSON.stringify(completion))
}

function cachePath(cacheDir: string, key: string): string {
  return join(cacheDir, "ai", `${key}.json`)
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
