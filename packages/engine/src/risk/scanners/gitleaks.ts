import { RiskCategory, RiskSeverity } from "@walkdiff/review-model"
import { z } from "zod"
import type { ScannerFinding } from "./scannerFinding.ts"

export const GITLEAKS_BINARY = "gitleaks"

const gitleaksOutputSchema = z.array(
  z.object({
    RuleID: z.string(),
    Description: z.string(),
    File: z.string(),
    StartLine: z.number().int(),
    EndLine: z.number().int(),
  }),
)

/**
 * `--ignore-gitleaks-allow` because a PR can add `gitleaks:allow` to hide its own secret.
 * `--redact` so the secret is never written, even to the temporary report file.
 */
export function gitleaksArgs(reportPath: string): string[] {
  return ["dir", ".", "--report-format", "json", "--report-path", reportPath, "--redact", "--ignore-gitleaks-allow", "--no-banner", "--exit-code", "0", "--log-level", "error"]
}

export function parseGitleaksReport(report: string): ScannerFinding[] {
  return gitleaksOutputSchema.parse(JSON.parse(report)).map((leak) => ({
    ruleId: `gitleaks.${leak.RuleID}`,
    category: RiskCategory.Secret,
    severity: RiskSeverity.High,
    title: `Possible secret: ${leak.RuleID.replaceAll("-", " ")}`,
    detail: `${leak.Description} A secret committed to a repository stays in its history even if removed later. Reported by gitleaks.`,
    path: leak.File,
    line: leak.StartLine,
    endLine: leak.EndLine,
    showLine: false,
  }))
}
