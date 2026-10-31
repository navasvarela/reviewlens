import { RiskCategory, RiskSeverity } from "@lens/review-model"
import { z } from "zod"
import type { ScannerFinding } from "./scannerFinding.ts"

export const SEMGREP_BINARY = "semgrep"

const semgrepOutputSchema = z.object({
  results: z.array(
    z.object({
      check_id: z.string(),
      path: z.string(),
      start: z.object({ line: z.number().int() }),
      end: z.object({ line: z.number().int() }),
      extra: z.object({ severity: z.string(), message: z.string() }),
    }),
  ),
})

/**
 * `--disable-nosem` because a PR can add `# nosemgrep` to hide its own finding. Metrics stay
 * off, and rules are only downloaded: no code is uploaded without a Semgrep login.
 */
export function semgrepArgs(rules: readonly string[]): string[] {
  return ["scan", "--json", "--quiet", "--metrics=off", "--disable-version-check", "--disable-nosem", "--no-git-ignore", ...rules.flatMap((rule) => ["--config", rule]), "."]
}

export function parseSemgrepOutput(stdout: string): ScannerFinding[] {
  const output = semgrepOutputSchema.parse(JSON.parse(stdout))
  return output.results.map((result) => {
    const isSecret = /(^|\.)secrets?\./.test(result.check_id)
    return {
      ruleId: `semgrep.${result.check_id}`,
      category: isSecret ? RiskCategory.Secret : RiskCategory.CodeScan,
      severity: severityOf(result.extra.severity),
      title: titleOf(result.check_id),
      detail: `${result.extra.message.trim()} Reported by Semgrep.`,
      path: result.path,
      line: result.start.line,
      endLine: result.end.line,
      // A secret must not be copied into the report from the line it sits on.
      showLine: !isSecret,
    }
  })
}

function severityOf(label: string): RiskSeverity {
  switch (label.toUpperCase()) {
    case "ERROR":
    case "CRITICAL":
    case "HIGH":
      return RiskSeverity.High
    case "INFO":
    case "LOW":
      return RiskSeverity.Low
    default:
      return RiskSeverity.Medium
  }
}

// `python.lang.security.audit.subprocess-shell-true.subprocess-shell-true` → "subprocess shell true".
function titleOf(checkId: string): string {
  return (checkId.split(".").at(-1) ?? checkId).replaceAll("-", " ")
}
