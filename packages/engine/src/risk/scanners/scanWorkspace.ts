import { mkdir, writeFile } from "node:fs/promises"
import { dirname, relative, resolve, sep } from "node:path"
import type { CheckRun, Risk, SkippedCheck } from "@lens/review-model"
import { addedLines, findingAt } from "../scannedFile.ts"
import type { ScannedFile } from "../scannedFile.ts"
import { redactSecrets } from "../secrets.ts"
import type { ScannerFinding } from "./scannerFinding.ts"

export interface ScanOutcome<Finding = ScannerFinding> {
  readonly findings: Finding[]
  readonly checksRun: CheckRun[]
  readonly notChecked: SkippedCheck[]
}

export function notRun<Finding = ScannerFinding>(check: string, reason: string): ScanOutcome<Finding> {
  return { findings: [], checksRun: [], notChecked: [{ check, reason }] }
}

/** Writes files under `root`, skipping any path that would land outside it. */
export async function writeScanFiles(root: string, files: readonly { readonly path: string; readonly text: string }[]): Promise<void> {
  const resolvedRoot = resolve(root)
  for (const file of files) {
    const target = resolve(root, file.path)
    if (!target.startsWith(resolvedRoot + sep)) continue
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.text)
  }
}

/** A scanner's file name relative to the scan folder, whichever way the scanner reports it. */
export function pathInScanRoot(root: string, fileName: string): string {
  return relative(root, resolve(root, fileName)).split(sep).join("/")
}

/** Keeps findings touching an added line, and turns them into report findings. */
export function toRisks(findings: readonly ScannerFinding[], files: readonly ScannedFile[]): Risk[] {
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
