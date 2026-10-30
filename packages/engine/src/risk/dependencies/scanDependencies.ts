import { basename } from "node:path"
import { FileChangeStatus, RiskCategory, RiskSeverity } from "@lens/review-model"
import type { CommitSha, FileDiff, Risk, SkippedCheck } from "@lens/review-model"
import { readBlobs } from "../../blobs.ts"
import { findingAt } from "../scannedFile.ts"
import type { RuleDescription } from "../scannedFile.ts"
import { findVulnerabilities, OsvUnavailableError } from "./osv.ts"
import type { VulnerablePackage } from "./osv.ts"
import { lockfileFormatFor, manifestFormatFor, UNREAD_LOCKFILES } from "./packages.ts"
import type { PackageVersion } from "./packages.ts"

export interface DependencyScanRequest {
  readonly repoDir: string
  readonly base: CommitSha
  readonly head: CommitSha
  readonly diffs: readonly FileDiff[]
  /** False skips the OSV lookup, which sends package names and versions to api.osv.dev. */
  readonly network: boolean
}

export interface DependencyScan {
  readonly findings: Risk[]
  readonly notChecked: SkippedCheck[]
}

const VULNERABILITY_CHECK = "Known vulnerabilities in new dependency versions"

const NEW_DEPENDENCY: RuleDescription = {
  id: "dependency.added",
  category: RiskCategory.Dependency,
  severity: RiskSeverity.Low,
  title: "New dependency",
  detail: "New code from outside the team. Check it is maintained, its licence fits, and it is really needed.",
}

/**
 * Compares manifests and lockfiles between the merge base and head: newly declared
 * dependencies become findings, and package versions new to a lockfile are checked
 * against the OSV vulnerability database.
 */
export async function scanDependencies(request: DependencyScanRequest): Promise<DependencyScan> {
  const relevant = request.diffs.filter(
    (diff) => diff.status !== FileChangeStatus.Deleted && (manifestFormatFor(diff.path) ?? lockfileFormatFor(diff.path)) !== undefined,
  )
  const findings: Risk[] = []
  const notChecked: SkippedCheck[] = request.diffs
    .filter((diff) => UNREAD_LOCKFILES.has(basename(diff.path)))
    .map((diff) => ({ check: `${VULNERABILITY_CHECK} (${diff.path})`, reason: `${basename(diff.path)} is not read yet` }))
  if (relevant.length === 0) {
    return { findings, notChecked }
  }

  const blobs = await readBlobs(
    request.repoDir,
    relevant.flatMap((diff) => [
      { commit: request.base, path: previousPathOf(diff) },
      { commit: request.head, path: diff.path },
    ]),
  )
  const newVersions: { version: PackageVersion; lockfile: string; text: string }[] = []
  relevant.forEach((diff, index) => {
    const before = blobs.at(2 * index)?.toString("utf8")
    const after = blobs.at(2 * index + 1)?.toString("utf8")
    if (after === undefined) return
    findings.push(...newlyDeclared(diff.path, before, after))
    for (const version of newlyLocked(diff.path, before, after)) {
      newVersions.push({ version, lockfile: diff.path, text: after })
    }
  })

  if (newVersions.length === 0) {
    return { findings, notChecked }
  }
  if (!request.network) {
    notChecked.push({ check: VULNERABILITY_CHECK, reason: "offline mode: the OSV database was not queried" })
    return { findings, notChecked }
  }
  try {
    const vulnerable = withoutAliasDuplicates(await findVulnerabilities(newVersions.map((entry) => entry.version)))
    for (const found of vulnerable) {
      const source = newVersions.find((entry) => entry.version === found.package)
      if (source !== undefined) findings.push(vulnerabilityFinding(found, source.lockfile, source.text))
    }
  } catch (error: unknown) {
    if (!(error instanceof OsvUnavailableError)) throw error
    notChecked.push({ check: VULNERABILITY_CHECK, reason: error.message })
  }
  return { findings, notChecked }
}

function newlyDeclared(path: string, before: string | undefined, after: string): Risk[] {
  const format = manifestFormatFor(path)
  if (format === undefined) return []
  const previous = before === undefined ? new Map<string, string>() : format.parse(before)
  return [...format.parse(after)]
    .filter(([name]) => !previous.has(name))
    .map(([name, requirement]) =>
      findingAt({ ...NEW_DEPENDENCY, title: `New dependency: ${name}` }, path, lineMentioning(after, name), `${name} ${requirement}`),
    )
}

function newlyLocked(path: string, before: string | undefined, after: string): PackageVersion[] {
  const format = lockfileFormatFor(path)
  if (format === undefined) return []
  const key = (entry: PackageVersion): string => `${entry.ecosystem}\0${entry.name}\0${entry.version}`
  const previous = new Set((before === undefined ? [] : format.parse(before)).map(key))
  const seen = new Set<string>()
  return format.parse(after).filter((entry) => {
    const entryKey = key(entry)
    if (previous.has(entryKey) || seen.has(entryKey)) return false
    seen.add(entryKey)
    return true
  })
}

/**
 * Databases publish the same issue under several IDs (a GHSA advisory and a RUSTSEC or
 * PYSEC entry naming each other as aliases). Keeps one per issue and package, preferring
 * the more severe rating.
 */
function withoutAliasDuplicates(found: readonly VulnerablePackage[]): VulnerablePackage[] {
  const bySeverity = [...found].sort((a, b) => SEVERITY_RANK[a.vulnerability.severity] - SEVERITY_RANK[b.vulnerability.severity])
  const kept: VulnerablePackage[] = []
  for (const candidate of bySeverity) {
    const names = new Set([candidate.vulnerability.id, ...candidate.vulnerability.aliases])
    const duplicate = kept.some(
      (existing) =>
        existing.package === candidate.package &&
        [existing.vulnerability.id, ...existing.vulnerability.aliases].some((name) => names.has(name)),
    )
    if (!duplicate) kept.push(candidate)
  }
  return kept
}

const SEVERITY_RANK: Readonly<Record<RiskSeverity, number>> = {
  [RiskSeverity.High]: 0,
  [RiskSeverity.Medium]: 1,
  [RiskSeverity.Low]: 2,
}

function vulnerabilityFinding(found: VulnerablePackage, lockfile: string, text: string): Risk {
  const { package: entry, vulnerability } = found
  const aliases = vulnerability.aliases.length > 0 ? ` (${vulnerability.aliases.join(", ")})` : ""
  const fix = vulnerability.fixedIn === undefined ? "No fixed version is recorded." : `Fixed in ${vulnerability.fixedIn}.`
  const rule: RuleDescription = {
    id: `vulnerability.${vulnerability.id}`,
    category: RiskCategory.Vulnerability,
    severity: vulnerability.severity,
    title: `${entry.name} ${entry.version}: ${vulnerability.id}${aliases}`,
    detail: `${vulnerability.summary ?? "Known vulnerability."} ${fix}`,
  }
  return findingAt(rule, lockfile, lineMentioning(text, entry.name), `${entry.name} ${entry.version}`)
}

/**
 * First line naming the package, so a finding links to where it is declared or locked:
 * a quoted name (JSON, TOML values) or the name at the start of a line (TOML keys,
 * requirements files), never as part of a longer name.
 */
function lineMentioning(text: string, name: string): number | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`"${escaped}"|^\\s*${escaped}(?![\\w.-])`)
  const index = text.split("\n").findIndex((line) => pattern.test(line))
  return index === -1 ? null : index + 1
}

function previousPathOf(diff: FileDiff): string {
  return diff.status === FileChangeStatus.Renamed || diff.status === FileChangeStatus.Copied ? diff.previousPath : diff.path
}
