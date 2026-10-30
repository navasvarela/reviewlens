import { matchesGlob } from "node:path"
import { RiskSeverity } from "@lens/review-model"
import type { CommitSha } from "@lens/review-model"
import { z } from "zod"
import { readBlobs } from "../blobs.ts"

/**
 * Per-repository settings, read from the head commit so a PR that edits them is judged
 * by its own rules.
 */
export const LENS_CONFIG_PATH = ".lens.json"

const lensConfigSchema = z.object({
  /** Areas the team considers sensitive beyond the built-in ones. */
  riskPaths: z
    .array(z.object({ pattern: z.string().min(1), severity: z.enum(RiskSeverity), reason: z.string().min(1) }))
    .default([]),
  /** Globs excluded from risk scanning, such as test fixtures full of fake secrets. */
  ignore: z.array(z.string().min(1)).default([]),
  /** `allowed: false` keeps this repository's code from ever being sent to a model. */
  ai: z.object({ allowed: z.boolean().default(true) }).default({ allowed: true }),
})
export type LensConfig = z.infer<typeof lensConfigSchema>

export const DEFAULT_LENS_CONFIG: LensConfig = { riskPaths: [], ignore: [], ai: { allowed: true } }

export class LensConfigError extends Error {
  override readonly name = "LensConfigError"
}

export async function readLensConfig(repoDir: string, head: CommitSha): Promise<LensConfig> {
  const [blob] = await readBlobs(repoDir, [{ commit: head, path: LENS_CONFIG_PATH }])
  if (blob === undefined) {
    return DEFAULT_LENS_CONFIG
  }
  let json: unknown
  try {
    json = JSON.parse(blob.toString("utf8"))
  } catch (error: unknown) {
    throw new LensConfigError(`${LENS_CONFIG_PATH} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const result = lensConfigSchema.safeParse(json)
  if (!result.success) {
    throw new LensConfigError(`${LENS_CONFIG_PATH} is invalid: ${result.error.message}`)
  }
  return result.data
}

export function isIgnored(config: LensConfig, path: string): boolean {
  return config.ignore.some((pattern) => matchesGlob(path, pattern))
}
