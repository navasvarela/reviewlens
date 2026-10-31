import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import type { CheckRun, Risk, SkippedCheck } from "@lens/review-model"
import { addedLines, findingAt, isThirdParty } from "../scannedFile.ts"
import type { ScannedFile } from "../scannedFile.ts"
import { redactSecrets } from "../secrets.ts"
import { GITLEAKS_BINARY, gitleaksArgs, parseGitleaksReport } from "./gitleaks.ts"
import type { ScannerFinding } from "./scannerFinding.ts"
import { firstErrorLine } from "./scannerProcess.ts"
import type { ScannerProcessRunner } from "./scannerProcess.ts"
import { parseSemgrepOutput, SEMGREP_BINARY, semgrepArgs } from "./semgrep.ts"

export interface CodeScanRequest {
  readonly files: readonly ScannedFile[]
  /** Semgrep rule packs, from the config on the merge base. */
  readonly semgrepRules: readonly string[]
  /** False skips Semgrep, which downloads its rules. */
  readonly network: boolean
  readonly run: ScannerProcessRunner
}

export interface CodeScanResult {
  readonly findings: Risk[]
  readonly checksRun: CheckRun[]
  readonly notChecked: SkippedCheck[]
}

const SEMGREP_CHECK = "Semgrep code scan"
const GITLEAKS_CHECK = "gitleaks secret scan"
const SEMGREP_INSTALL = "not installed; install with `pipx install semgrep` or `brew install semgrep`"
const GITLEAKS_INSTALL = "not installed; install with `brew install gitleaks`"
const SEMGREP_SUCCESS_EXIT_CODE = 0
const GITLEAKS_REPORT_FILE = "gitleaks-report.json"
const SCAN_ROOT_DIR = "files"

/**
 * Files in a PR that would change how a scanner treats that same PR: a `.gitleaks.toml` with
 * an allowlist silences gitleaks entirely, and a `.semgrepignore` hides whole directories.
 * They are never copied into the scan folder.
 */
const SCANNER_CONTROL_FILES: ReadonlySet<string> = new Set([".gitleaks.toml", ".gitleaksignore", ".gitleaks.baseline", ".semgrepignore", ".semgrep.yml", ".semgrep.yaml", ".semgrepconfig.yml"])
// Semgrep's built-in ignore list skips tests and more when no ignore file exists; an empty
// one means every copied file is scanned.
const EMPTY_IGNORE_FILE = ".semgrepignore"

/**
 * Runs the installed code scanners over the head version of the changed files, keeping only
 * findings on lines this PR added: anything else was already there before the change.
 */
export async function runCodeScanners(request: CodeScanRequest): Promise<CodeScanResult> {
  const candidates = request.files.filter((file) => file.after !== undefined && !isThirdParty(file) && !isScannerControlPath(file.diff.path))
  if (candidates.length === 0) {
    return { findings: [], checksRun: [], notChecked: [] }
  }

  const workspace = await mkdtemp(join(tmpdir(), "lens-scan-"))
  try {
    const root = join(workspace, SCAN_ROOT_DIR)
    await copyFiles(root, candidates)
    await writeFile(join(root, EMPTY_IGNORE_FILE), "")
    const outcomes = await Promise.all([runSemgrep(request, root), runGitleaks(request, root, workspace)])
    return {
      findings: toRisks(outcomes.flatMap((outcome) => outcome.findings), candidates),
      checksRun: outcomes.flatMap((outcome) => outcome.checksRun),
      notChecked: outcomes.flatMap((outcome) => outcome.notChecked),
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

// Any segment, not only the file name: a folder called `.semgrepignore` would stop the empty
// ignore file being written.
function isScannerControlPath(path: string): boolean {
  return path.split("/").some((segment) => SCANNER_CONTROL_FILES.has(segment))
}

interface ScanOutcome {
  readonly findings: ScannerFinding[]
  readonly checksRun: CheckRun[]
  readonly notChecked: SkippedCheck[]
}

async function copyFiles(root: string, files: readonly ScannedFile[]): Promise<void> {
  const resolvedRoot = resolve(root)
  for (const file of files) {
    const target = resolve(root, file.diff.path)
    if (!target.startsWith(resolvedRoot + sep) || file.after === undefined) continue
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.after)
  }
}

function notRun(check: string, reason: string): ScanOutcome {
  return { findings: [], checksRun: [], notChecked: [{ check, reason }] }
}

async function runSemgrep(request: CodeScanRequest, root: string): Promise<ScanOutcome> {
  if (request.semgrepRules.length === 0) return notRun(SEMGREP_CHECK, "turned off in .lens.json")
  if (!request.network) return notRun(SEMGREP_CHECK, "offline mode: Semgrep downloads its rules")
  const result = await request.run(SEMGREP_BINARY, semgrepArgs(request.semgrepRules), root)
  if (result === undefined) return notRun(SEMGREP_CHECK, SEMGREP_INSTALL)
  if (result.exitCode !== SEMGREP_SUCCESS_EXIT_CODE) return notRun(SEMGREP_CHECK, `it failed: ${firstErrorLine(result)}`)
  try {
    return { findings: parseSemgrepOutput(result.stdout), checksRun: [{ name: "Semgrep", detail: `rules: ${request.semgrepRules.join(", ")}` }], notChecked: [] }
  } catch (error: unknown) {
    return notRun(SEMGREP_CHECK, `its output could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function runGitleaks(request: CodeScanRequest, root: string, workspace: string): Promise<ScanOutcome> {
  // The report goes outside the scanned folder, so gitleaks cannot scan its own output.
  const reportPath = join(workspace, GITLEAKS_REPORT_FILE)
  const result = await request.run(GITLEAKS_BINARY, gitleaksArgs(reportPath), root)
  if (result === undefined) return notRun(GITLEAKS_CHECK, GITLEAKS_INSTALL)
  if (result.exitCode !== 0) return notRun(GITLEAKS_CHECK, `it failed: ${firstErrorLine(result)}`)
  try {
    return { findings: parseGitleaksReport(await readFile(reportPath, "utf8")), checksRun: [{ name: "gitleaks", detail: "default rules" }], notChecked: [] }
  } catch (error: unknown) {
    return notRun(GITLEAKS_CHECK, `its report could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Keeps findings touching an added line, and turns them into report findings. */
function toRisks(findings: readonly ScannerFinding[], files: readonly ScannedFile[]): Risk[] {
  const added = new Map(files.map((file) => [file.diff.path, new Set(addedLines(file.diff).map((line) => line.line))]))
  const texts = new Map(files.map((file) => [file.diff.path, file.after?.split("\n") ?? []]))
  return findings.flatMap((finding) => {
    const lines = added.get(finding.path)
    if (lines === undefined || !touchesAddedLine(finding, lines)) return []
    const line = texts.get(finding.path)?.at(finding.line - 1)
    const evidence = finding.showLine && line !== undefined ? redactSecrets(line) : null
    return [
      findingAt(
        { id: finding.ruleId, category: finding.category, severity: finding.severity, title: finding.title, detail: finding.detail },
        finding.path,
        finding.line,
        evidence,
      ),
    ]
  })
}

function touchesAddedLine(finding: ScannerFinding, added: ReadonlySet<number>): boolean {
  for (let line = finding.line; line <= finding.endLine; line++) {
    if (added.has(line)) return true
  }
  return false
}
