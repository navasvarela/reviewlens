import { RiskCategory, RiskSeverity } from "@lens/review-model"
import type { Risk } from "@lens/review-model"
import { addedLines, findingAt, isThirdParty } from "./scannedFile.ts"
import type { RuleDescription, ScannedFile } from "./scannedFile.ts"

interface SecretRule extends RuleDescription {
  readonly pattern: RegExp
  /** Group holding the secret itself, when the match also covers surrounding syntax. */
  readonly secretGroup: number
}

const LEAKED_CREDENTIAL_DETAIL =
  "A credential committed to the repository stays in its history even if removed later. Revoke it and load it from a secret store instead."

function credential(id: string, title: string, pattern: RegExp): SecretRule {
  return { id, category: RiskCategory.Secret, severity: RiskSeverity.High, title, detail: LEAKED_CREDENTIAL_DETAIL, pattern, secretGroup: 0 }
}

// Token formats published by each provider; prefixes make false positives rare.
const SECRET_RULES: readonly SecretRule[] = [
  credential("secret.private-key", "Private key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/),
  credential("secret.aws-access-key", "AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/),
  credential("secret.github-token", "GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})\b/),
  credential("secret.gitlab-token", "GitLab token", /\bglpat-[A-Za-z0-9_-]{20}\b/),
  credential("secret.slack-token", "Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/),
  credential("secret.stripe-key", "Stripe live key", /\b[rs]k_live_[0-9A-Za-z]{24,}\b/),
  credential("secret.google-api-key", "Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/),
  credential("secret.anthropic-key", "Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/),
  credential("secret.openai-key", "OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/),
  {
    id: "secret.jwt",
    category: RiskCategory.Secret,
    severity: RiskSeverity.Medium,
    title: "JSON Web Token",
    detail: "A signed token in source may still be valid. Check it is a test fixture, not a real session or service token.",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    secretGroup: 0,
  },
  {
    id: "secret.hardcoded-credential",
    category: RiskCategory.Secret,
    severity: RiskSeverity.Medium,
    title: "Hard-coded credential",
    detail: "A password, secret or API key assigned a literal value. If it is real, revoke it and load it from configuration instead.",
    pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i,
    secretGroup: 1,
  },
]

// Values that are obviously not real credentials: placeholders, templates, references.
const PLACEHOLDER = /example|sample|dummy|placeholder|changeme|your[_-]|xxxx|\*\*\*|\$\{|\{\{|<[a-z_-]+>|^test|^fake/i
// Characters of a secret kept visible in evidence, enough to recognise it, not to use it.
const VISIBLE_SECRET_PREFIX = 4

/** Scans added lines of every first-party text file for credentials. */
export function scanSecrets(files: readonly ScannedFile[]): Risk[] {
  const findings: Risk[] = []
  for (const file of files) {
    if (isThirdParty(file)) continue
    for (const { line, content } of addedLines(file.diff)) {
      for (const rule of SECRET_RULES) {
        const match = rule.pattern.exec(content)
        const secret = match?.[rule.secretGroup]
        if (match === null || secret === undefined || PLACEHOLDER.test(secret)) continue
        findings.push(findingAt(rule, file.diff.path, line, redact(content, secret)))
      }
    }
  }
  return findings
}

function redact(line: string, secret: string): string {
  return line.replace(secret, `${secret.slice(0, VISIBLE_SECRET_PREFIX)}…[redacted]`)
}
