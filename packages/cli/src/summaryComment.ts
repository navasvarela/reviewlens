import { AiReviewStatus, changedUnitsOf, IntentVerdict, isBehaviourChange, namesOfChecks, RiskSeverity, untouchedReferences } from "@walkdiff/review-model"
import type { AiReview, Risk, ReviewModel } from "@walkdiff/review-model"

/** Finds this tool's earlier comment so later runs replace it instead of adding another. */
export const SUMMARY_COMMENT_MARKER = "<!-- walkdiff-report -->"

const SEVERITY_LABELS: Readonly<Record<RiskSeverity, string>> = {
  [RiskSeverity.High]: "High",
  [RiskSeverity.Medium]: "Medium",
  [RiskSeverity.Low]: "Low",
}
const MAX_FINDINGS_SHOWN = 5

/** The PR comment: what a reviewer should know before deciding whether to open the report. */
export function renderSummaryComment(model: ReviewModel, reportUrl: string): string {
  const lines = [
    SUMMARY_COMMENT_MARKER,
    `### Walkdiff: security level **${SEVERITY_LABELS[model.risk.securityLevel]}**`,
    "",
    ...reviewCounts(model),
    ...aiLine(model.ai),
    "",
    ...topFindings(model.risk.findings),
    `**[Open the full report](${reportUrl})**. It is a single HTML file; if it downloads, open it in a browser.`,
    "",
    `Low means no security problems turned up with ${namesOfChecks(model.risk.checksRun)}, not that the change is safe. ${notCheckedSentence(model.risk.notChecked.length)}`,
    "",
    feedbackLine(model.feedbackUrl),
  ]
  return lines.join("\n")
}

function reviewCounts(model: ReviewModel): string[] {
  const units = model.files.flatMap(changedUnitsOf)
  const toReview = units.filter((unit) => isBehaviourChange(unit.change)).length
  const collapsed = units.length - toReview
  const skippable = model.files.filter((file) => file.noise !== null).length
  const untouched = units.reduce((sum, unit) => sum + untouchedReferences(unit).length, 0)
  const counts = [`**${toReview}** code ${plural(toReview, "unit")} to review`]
  if (collapsed > 0) counts.push(`${collapsed} collapsed as formatting, comments, renames or moves`)
  if (skippable > 0) counts.push(`${skippable} skippable ${plural(skippable, "file")}`)
  const lines = [`- ${counts.join(", ")}`]
  if (untouched > 0) lines.push(`- **${untouched}** ${plural(untouched, "place")} this PR did not touch use code it changed`)
  return lines
}

function aiLine(ai: AiReview): string[] {
  switch (ai.status) {
    case AiReviewStatus.Disabled:
      return []
    case AiReviewStatus.Unavailable:
      return ["- AI review requested but not produced; the report says why"]
    case AiReviewStatus.Completed: {
      const contradictions = ai.intent.filter((finding) => finding.verdict === IntentVerdict.Contradicts).length
      const contradictionNote = contradictions > 0 ? `, ${contradictions} possible ${plural(contradictions, "mismatch", "mismatches")} with the description` : ""
      return [`- AI review: a reading order and ${ai.questions.length} ${plural(ai.questions.length, "question")} to answer${contradictionNote}`]
    }
  }
}

function topFindings(findings: readonly Risk[]): string[] {
  if (findings.length === 0) return []
  const groups = new Map<string, { readonly first: Risk; count: number }>()
  for (const finding of findings) {
    const group = groups.get(finding.title)
    if (group === undefined) groups.set(finding.title, { first: finding, count: 1 })
    else group.count++
  }
  const shown = [...groups.values()].slice(0, MAX_FINDINGS_SHOWN).map(({ first, count }) => {
    const repeat = count > 1 ? ` (×${count})` : ""
    const place = first.location === null || count > 1 ? "" : ` in ${inlineCode(first.location.path)}`
    return `- ${SEVERITY_LABELS[first.severity]}: ${escapeMarkdown(first.title)}${repeat}${place}`
  })
  const hidden = groups.size - shown.length
  return ["**Findings**", ...shown, ...(hidden > 0 ? [`- and ${hidden} more in the report`] : []), ""]
}

function notCheckedSentence(count: number): string {
  return count === 0 ? "" : `${count} ${plural(count, "check")} did not run; the report lists them.`
}

function feedbackLine(feedbackUrl: string | null): string {
  const form = feedbackUrl === null ? "" : `, or [leave feedback](${feedbackUrl})`
  return `Was this useful? React with 👍 or 👎${form}.`
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm
}

/**
 * Titles carry names from the PR, such as functions and packages. Anyone can open a PR, so
 * a crafted name must not ping people, add links or images, or close the list.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_[\]<>|~!]/g, "\\$&")
    .replace(/([@#])/g, "$1​")
}

function inlineCode(text: string): string {
  return `\`${text.replace(/[`\r\n]/g, "")}\``
}
