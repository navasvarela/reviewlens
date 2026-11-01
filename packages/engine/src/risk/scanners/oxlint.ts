import { RiskCategory, RiskSeverity } from "@walkdiff/review-model"
import { z } from "zod"
import type { ScannerFinding } from "./scannerFinding.ts"
import { pathInScanRoot } from "./scanWorkspace.ts"

export const OXLINT_BINARY = "oxlint"

// Untidy rather than likely wrong; every other rule oxlint runs by default is its "correctness" set.
const LOW_SEVERITY_RULES: ReadonlySet<string> = new Set(["eslint(no-unused-vars)"])
const RULE_NAME = /^([\w-]+)\((.+)\)$/

const oxlintOutputSchema = z.object({
  diagnostics: z.array(
    z.object({
      code: z.string().optional(),
      filename: z.string(),
      url: z.string().optional(),
      labels: z.array(z.object({ span: z.object({ line: z.number().int() }) })).default([]),
    }),
  ),
})

/**
 * Our config, and no nested ones, because oxlint would otherwise obey a config file in the PR, and
 * can run a TypeScript one. Inline `eslint-disable` comments stay honoured: oxlint has no flag to
 * ignore them, and each one is visible in the diff.
 */
export function oxlintArgs(configPath: string): string[] {
  return ["--format", "json", "-c", configPath, "--disable-nested-config", "--no-ignore", "."]
}

export function parseOxlintOutput(stdout: string, root: string): ScannerFinding[] {
  return oxlintOutputSchema.parse(JSON.parse(stdout)).diagnostics.flatMap((diagnostic) => {
    const line = diagnostic.labels.at(0)?.span.line
    // Without a code it is a parse failure, not a finding about the code.
    if (diagnostic.code === undefined || line === undefined) return []
    const [, plugin, rule] = RULE_NAME.exec(diagnostic.code) ?? [undefined, "oxc", diagnostic.code]
    return [{
      ruleId: `oxlint.${plugin}.${rule}`,
      category: RiskCategory.CodeQuality,
      severity: LOW_SEVERITY_RULES.has(diagnostic.code) ? RiskSeverity.Low : RiskSeverity.Medium,
      title: (rule ?? diagnostic.code).replaceAll("-", " "),
      detail: `Reported by oxlint, rule ${diagnostic.code}.${diagnostic.url === undefined ? "" : ` See ${diagnostic.url}.`}`,
      path: pathInScanRoot(root, diagnostic.filename),
      line,
      endLine: line,
      showLine: true,
    }]
  })
}
