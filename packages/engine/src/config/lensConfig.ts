import { matchesGlob } from "node:path"
import { RiskSeverity } from "@lens/review-model"
import type { CommitSha } from "@lens/review-model"
import { z } from "zod"
import { readBlobs } from "../blobs.ts"

/**
 * Per-repository settings. Callers read them from the merge base, not the PR's head: a PR
 * must not be able to loosen the rules it is judged by, for example by ignoring every path.
 */
export const LENS_CONFIG_PATH = ".lens.json"

// Semgrep's general-purpose pack; its noisier audit packs are left for teams to opt into.
const DEFAULT_SEMGREP_RULES = ["p/default"]

export const lensConfigSchema = z.object({
  /** Areas the team considers sensitive beyond the built-in ones. */
  riskPaths: z
    .array(z.object({ pattern: z.string().min(1), severity: z.enum(RiskSeverity), reason: z.string().min(1) }))
    .default([]),
  /** Globs excluded from risk scanning, such as test fixtures full of fake secrets. */
  ignore: z.array(z.string().min(1)).default([]),
  /** `allowed: false` keeps this repository's code from ever being sent to a model. */
  ai: z.object({ allowed: z.boolean().default(true) }).default({ allowed: true }),
  /** Semgrep rule packs from its registry; an empty list turns Semgrep off. */
  scanners: z
    .object({ semgrep: z.object({ rules: z.array(z.string().regex(/^[pr]\/[\w./-]+$/)).default(DEFAULT_SEMGREP_RULES) }).default({ rules: DEFAULT_SEMGREP_RULES }) })
    .default({ semgrep: { rules: DEFAULT_SEMGREP_RULES } }),
  /** `enabled: false` turns off function metrics, linters and duplicate detection. */
  quality: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  /** Where pilot users send feedback; shown in the report and the PR comment. */
  feedback: z.object({ url: z.url({ protocol: /^https?$/ }).nullable().default(null) }).default({ url: null }),
})
export type LensConfig = z.infer<typeof lensConfigSchema>

export const DEFAULT_LENS_CONFIG: LensConfig = { riskPaths: [], ignore: [], ai: { allowed: true }, scanners: { semgrep: { rules: DEFAULT_SEMGREP_RULES } }, quality: { enabled: true }, feedback: { url: null } }

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
  // Changes to the config itself are always reported, whatever it says.
  return path !== LENS_CONFIG_PATH && config.ignore.some((pattern) => matchesGlob(path, pattern))
}
