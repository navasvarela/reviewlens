import { matchesGlob } from "node:path"
import { RiskSeverity } from "@lens/review-model"
import type { CommitSha } from "@lens/review-model"
import { z } from "zod"
import { readBlobs } from "../blobs.ts"

/** Read from the head commit, so a PR that edits the config is judged by its own rules. */
export const RISK_CONFIG_PATH = ".lens.json"

const riskConfigSchema = z.object({
  /** Areas the team considers sensitive beyond the built-in ones. */
  riskPaths: z
    .array(z.object({ pattern: z.string().min(1), severity: z.enum(RiskSeverity), reason: z.string().min(1) }))
    .default([]),
  /** Globs excluded from risk scanning, such as test fixtures full of fake secrets. */
  ignore: z.array(z.string().min(1)).default([]),
})
export type RiskConfig = z.infer<typeof riskConfigSchema>

export const EMPTY_RISK_CONFIG: RiskConfig = { riskPaths: [], ignore: [] }

export class RiskConfigError extends Error {
  override readonly name = "RiskConfigError"
}

export async function readRiskConfig(repoDir: string, head: CommitSha): Promise<RiskConfig> {
  const [blob] = await readBlobs(repoDir, [{ commit: head, path: RISK_CONFIG_PATH }])
  if (blob === undefined) {
    return EMPTY_RISK_CONFIG
  }
  let json: unknown
  try {
    json = JSON.parse(blob.toString("utf8"))
  } catch (error: unknown) {
    throw new RiskConfigError(`${RISK_CONFIG_PATH} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const result = riskConfigSchema.safeParse(json)
  if (!result.success) {
    throw new RiskConfigError(`${RISK_CONFIG_PATH} is invalid: ${result.error.message}`)
  }
  return result.data
}

export function isIgnored(config: RiskConfig, path: string): boolean {
  return config.ignore.some((pattern) => matchesGlob(path, pattern))
}
