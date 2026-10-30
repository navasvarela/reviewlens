import { extname } from "node:path"
import { RiskCategory, RiskSeverity } from "@lens/review-model"
import type { ChangedFile, CommitSha, Risk, RiskAssessment, SkippedCheck } from "@lens/review-model"
import { scanDangerousApis } from "./dangerousApis.ts"
import { scanDependencies } from "./dependencies/scanDependencies.ts"
import { reviewSignals } from "./reviewSignals.ts"
import { isIgnored, readLensConfig, LENS_CONFIG_PATH } from "../config/lensConfig.ts"
import type { ScannedFile } from "./scannedFile.ts"
import { scanSecrets } from "./secrets.ts"
import { scanSensitivePaths } from "./sensitivePaths.ts"

export interface RiskAssessmentRequest {
  readonly repoDir: string
  readonly base: CommitSha
  readonly head: CommitSha
  readonly files: readonly ChangedFile[]
  /** Head text of each file in `files`, aligned by index; undefined where not read. */
  readonly headTexts: readonly (string | undefined)[]
  readonly network: boolean
}

/** Categories that make up the security level; the others are review signals. */
const SECURITY_CATEGORIES: ReadonlySet<RiskCategory> = new Set([
  RiskCategory.Secret,
  RiskCategory.DangerousApi,
  RiskCategory.SensitivePath,
  RiskCategory.Dependency,
  RiskCategory.Vulnerability,
])

const SEVERITY_RANK: Readonly<Record<RiskSeverity, number>> = {
  [RiskSeverity.High]: 0,
  [RiskSeverity.Medium]: 1,
  [RiskSeverity.Low]: 2,
}

// Languages a team might change that the dangerous-API rules do not cover.
const UNCOVERED_CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".go", ".java", ".kt", ".rb", ".php", ".cs", ".c", ".cc", ".cpp", ".h", ".hpp", ".swift", ".scala", ".sh",
])

const ALWAYS_SKIPPED: readonly SkippedCheck[] = [
  {
    check: "Third-party scanners (Semgrep, gitleaks, osv-scanner)",
    reason: "not integrated yet; only the built-in secret, API and path rules ran",
  },
  {
    check: "Change history (frequently changed or bug-prone files)",
    reason: "needs repository history, which the CLI does not fetch",
  },
]

/** Runs every risk check over the change and rates its security level. */
export async function assessRisk(request: RiskAssessmentRequest): Promise<RiskAssessment> {
  const config = await readLensConfig(request.repoDir, request.head)
  const scanned: ScannedFile[] = request.files
    .map((file, index) => ({ diff: file.diff, noise: file.noise, after: request.headTexts.at(index) }))
    .filter((file) => !isIgnored(config, file.diff.path))

  const dependencies = await scanDependencies({
    repoDir: request.repoDir,
    base: request.base,
    head: request.head,
    diffs: scanned.map((file) => file.diff),
    network: request.network,
  })
  const findings = [
    ...scanSecrets(scanned),
    ...(await scanDangerousApis(scanned)),
    ...scanSensitivePaths(scanned, config),
    ...dependencies.findings,
    ...reviewSignals(request.files),
  ].sort(byImportance)

  return {
    securityLevel: securityLevelOf(findings),
    findings,
    notChecked: [...dependencies.notChecked, ...coverageGaps(request.files, request.files.length - scanned.length), ...ALWAYS_SKIPPED],
  }
}

// Low means "nothing found by the checks that ran", never "safe"; notChecked says what did not run.
function securityLevelOf(findings: readonly Risk[]): RiskSeverity {
  const security = findings.filter((finding) => SECURITY_CATEGORIES.has(finding.category))
  if (security.some((finding) => finding.severity === RiskSeverity.High)) return RiskSeverity.High
  if (security.some((finding) => finding.severity === RiskSeverity.Medium)) return RiskSeverity.Medium
  return RiskSeverity.Low
}

function coverageGaps(files: readonly ChangedFile[], ignoredCount: number): SkippedCheck[] {
  const gaps: SkippedCheck[] = []
  if (ignoredCount > 0) {
    gaps.push({ check: `Risk rules on ${ignoredCount} ${ignoredCount === 1 ? "file" : "files"}`, reason: `excluded by "ignore" in ${LENS_CONFIG_PATH}` })
  }
  const uncovered = [...new Set(files.map((file) => extname(file.diff.path)).filter((extension) => UNCOVERED_CODE_EXTENSIONS.has(extension)))]
  if (uncovered.length > 0) {
    gaps.push({ check: `Dangerous-API rules for ${uncovered.join(", ")} files`, reason: "rules exist only for Rust, TypeScript/JavaScript and Python" })
  }
  return gaps
}

// Most severe first; at equal severity, security findings before review signals, then by place.
function byImportance(a: Risk, b: Risk): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    Number(SECURITY_CATEGORIES.has(b.category)) - Number(SECURITY_CATEGORIES.has(a.category)) ||
    (a.location?.path ?? "").localeCompare(b.location?.path ?? "") ||
    (a.location?.line ?? 0) - (b.location?.line ?? 0)
  )
}
