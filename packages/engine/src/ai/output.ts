import { CitationSide, IntentVerdict } from "@lens/review-model"
import type { Chapter, Citation, IntentFinding, ReviewerQuestion, UnitRef } from "@lens/review-model"
import { z } from "zod"
import type { PromptPlan, ShownRange } from "./prompt.ts"

const rawCitationSchema = z.object({
  path: z.string(),
  side: z.enum(CitationSide),
  startLine: z.number().int(),
  endLine: z.number().int(),
})

const rawChapterSchema = z.object({ title: z.string(), summary: z.string(), unitIds: z.array(z.string()) })
type RawChapter = z.infer<typeof rawChapterSchema>

/** What the model is asked to return; validated against the change before anything is shown. */
export const rawAiOutputSchema = z.object({
  chapters: z.array(rawChapterSchema),
  intent: z.array(
    z.object({
      claim: z.string(),
      verdict: z.enum([IntentVerdict.Matches, IntentVerdict.Contradicts, IntentVerdict.Undocumented, IntentVerdict.NotFound]),
      explanation: z.string(),
      citations: z.array(rawCitationSchema),
    }),
  ),
  questions: z.array(z.object({ question: z.string(), why: z.string(), citations: z.array(rawCitationSchema) })),
})
export type RawAiOutput = z.infer<typeof rawAiOutputSchema>

export interface ValidatedOutput {
  readonly chapters: Chapter[]
  readonly intent: IntentFinding[]
  readonly questions: ReviewerQuestion[]
  readonly droppedStatements: number
}

const UNGROUPED_CHAPTER_TITLE = "Other changes"

/**
 * Keeps only what the change supports. A citation survives if its lines lie inside a range
 * the model was shown; a statement survives if at least one of its citations does (or it
 * is a "notFound" verdict, which by definition has none). Chapters may name only known
 * units, each once; units the model left out are gathered in a final chapter.
 */
export function validateOutput(raw: RawAiOutput, plan: PromptPlan): ValidatedOutput {
  let dropped = 0
  const supported = (citations: readonly Citation[]): Citation[] => citations.filter((citation) => isShown(citation, plan.shownRanges))

  const intent = raw.intent.flatMap((entry): IntentFinding[] => {
    if (entry.verdict === IntentVerdict.NotFound) {
      return [{ claim: entry.claim, verdict: entry.verdict, explanation: entry.explanation, citations: [] }]
    }
    const citations = supported(entry.citations)
    if (citations.length === 0) {
      dropped++
      return []
    }
    return [{ ...entry, citations }]
  })

  const questions = raw.questions.flatMap((entry): ReviewerQuestion[] => {
    const citations = supported(entry.citations)
    if (citations.length === 0) {
      dropped++
      return []
    }
    return [{ question: entry.question, why: entry.why, citations }]
  })

  return { chapters: validateChapters(raw.chapters, plan.unitsById), intent, questions, droppedStatements: dropped }
}

function validateChapters(raw: readonly RawChapter[], unitsById: ReadonlyMap<string, UnitRef>): Chapter[] {
  const placed = new Set<string>()
  const chapters = raw.flatMap((chapter): Chapter[] => {
    const units = chapter.unitIds.flatMap((id) => {
      const unit = unitsById.get(id)
      if (unit === undefined || placed.has(id)) return []
      placed.add(id)
      return [unit]
    })
    return units.length === 0 ? [] : [{ title: chapter.title, summary: chapter.summary, units }]
  })
  const ungrouped = [...unitsById].filter(([id]) => !placed.has(id)).map(([, unit]) => unit)
  if (ungrouped.length > 0) {
    chapters.push({ title: UNGROUPED_CHAPTER_TITLE, summary: "Units the model did not place in a chapter.", units: ungrouped })
  }
  return chapters
}

function isShown(citation: Citation, ranges: readonly ShownRange[]): boolean {
  return (
    citation.startLine >= 1 &&
    citation.startLine <= citation.endLine &&
    ranges.some(
      (range) =>
        range.path === citation.path &&
        range.side === citation.side &&
        citation.startLine >= range.startLine &&
        citation.endLine <= range.endLine,
    )
  )
}
