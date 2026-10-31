import { extname } from "node:path"
import { RiskCategory, RiskSeverity } from "@lens/review-model"
import type { ChangedFile, CheckRun, CommitSha, Risk, RiskAssessment, SkippedCheck } from "@lens/review-model"
import { scanDangerousApis } from "./dangerousApis.ts"
import { scanDependencies } from "./dependencies/scanDependencies.ts"
import { reviewSignals } from "./reviewSignals.ts"
import { isIgnored, readLensConfig, LENS_CONFIG_PATH } from "../config/lensConfig.ts"
import type { ScannedFile } from "./scannedFile.ts"
import { scanSecrets } from "./secrets.ts"
import { runCodeScanners } from "./scanners/runCodeScanners.ts"
import type { ScannerProcessRunner } from "./scanners/scannerProcess.ts"
import { scanSensitivePaths } from "./sensitivePaths.ts"

export interface RiskAssessmentRequest {
  readonly repoDir: string
  readonly base: CommitSha
  readonly head: CommitSha
  readonly files: readonly ChangedFile[]
  /** Head text of each file in `files`, aligned by index; undefined where not read. */
  readonly headTexts: readonly (string | undefined)[]
  readonly network: boolean
  readonly runScanner: ScannerProcessRunner
}

/** Categories that make up the security level; the others are review signals. */
const SECURITY_CATEGORIES: ReadonlySet<RiskCategory> = new Set([
  RiskCategory.Secret,
  RiskCategory.DangerousApi,
  RiskCategory.SensitivePath,
  RiskCategory.Dependency,
  RiskCategory.Vulnerability,
  RiskCategory.CodeScan,
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
    check: "Change history (frequently changed or bug-prone files)",
    reason: "needs repository history, which the CLI does not fetch",
  },
]

const BUILT_IN_CHECK: CheckRun = { name: "Built-in rules", detail: "secrets, risky APIs and sensitive paths" }

/** Runs every risk check over the change and rates its security level. */
export async function assessRisk(request: RiskAssessmentRequest): Promise<RiskAssessment> {
  const config = await readLensConfig(request.repoDir, request.base)
  const scanned: ScannedFile[] = request.files
    .map((file, index) => ({ diff: file.diff, noise: file.noise, after: request.headTexts.at(index) }))
    .filter((file) => !isIgnored(config, file.diff.path))

  const dependencies = await scanDependencies({
    repoDir: request.repoDir,
    base: request.base,
    head: request.head,
    diffs: scanned.map((file) => file.diff),
    network: request.network,
    runScanner: request.runScanner,
  })
  const codeScan = await runCodeScanners({ files: scanned, semgrepRules: config.scanners.semgrep.rules, network: request.network, run: request.runScanner })
  const findings = withoutRepeatedSecrets([
    ...scanSecrets(scanned),
    ...(await scanDangerousApis(scanned)),
    ...scanSensitivePaths(scanned, config),
    ...codeScan.findings,
    ...dependencies.findings,
    ...reviewSignals(request.files),
  ]).sort(byImportance)

  return {
    securityLevel: securityLevelOf(findings),
    findings,
    checksRun: [BUILT_IN_CHECK, ...codeScan.checksRun, ...dependencies.checksRun],
    notChecked: [...codeScan.notChecked, ...dependencies.notChecked, ...coverageGaps(request.files, request.files.length - scanned.length), ...ALWAYS_SKIPPED],
  }
}

// Our rules, gitleaks and Semgrep can all flag one secret; one finding per line is enough.
// The built-in rules come first, so theirs is the one kept.
function withoutRepeatedSecrets(findings: readonly Risk[]): Risk[] {
  const seen = new Set<string>()
  return findings.filter((finding) => {
    if (finding.category !== RiskCategory.Secret || finding.location === null) return true
    const key = `${finding.location.path}\0${finding.location.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
