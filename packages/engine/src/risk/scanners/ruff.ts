import { RiskCategory, RiskSeverity } from "@lens/review-model"
import { z } from "zod"
import type { ScannerFinding } from "./scannerFinding.ts"
import { pathInScanRoot } from "./scanWorkspace.ts"

export const RUFF_BINARY = "ruff"

// Pyflakes, flake8-bugbear, and the pycodestyle rules about statements and syntax: likely bugs and
// bad practice. Ruff's style and formatting rules are left out because they would drown these.
const SELECTED_RULES = "F,B,E7,E9"
// Likely to be wrong at runtime rather than untidy: undefined names, misused `print` and `assert`,
// misplaced statements, bugbear's rules, and syntax errors.
const LIKELY_BUG_PREFIXES: readonly string[] = ["F82", "F63", "F7", "B", "E9"]

const ruffOutputSchema = z.array(
  z.object({
    code: z.string().nullable(),
    name: z.string().optional(),
    filename: z.string(),
    location: z.object({ row: z.number().int() }),
    end_location: z.object({ row: z.number().int() }),
    url: z.string().nullable().optional(),
  }),
)

/** `--isolated` ignores every Ruff config file, so the rules are the same for any repository. */
export function ruffArgs(): string[] {
  return ["check", "--isolated", "--output-format", "json", "--no-cache", "--exit-zero", "--select", SELECTED_RULES, "."]
}

export function parseRuffOutput(stdout: string, root: string): ScannerFinding[] {
  return ruffOutputSchema.parse(JSON.parse(stdout)).flatMap((violation) => {
    // Without a code it is a syntax error, which the PR's own tooling reports better.
    if (violation.code === null) return []
    const code = violation.code
    return [{
      ruleId: `ruff.${code}`,
      category: RiskCategory.CodeQuality,
      severity: LIKELY_BUG_PREFIXES.some((prefix) => code.startsWith(prefix)) ? RiskSeverity.Medium : RiskSeverity.Low,
      title: (violation.name ?? code).replaceAll("-", " "),
      detail: `Reported by Ruff, rule ${code}.${violation.url ? ` See ${violation.url}.` : ""}`,
      path: pathInScanRoot(root, violation.filename),
      line: violation.location.row,
      endLine: violation.end_location.row,
      showLine: true,
    }]
  })
}
