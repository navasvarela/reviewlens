import { z } from "zod"

export const JSCPD_BINARY = "jscpd"
export const JSCPD_REPORT_FILE = "jscpd-report.json"

// jscpd's default token count, with double its default lines so that imports and small constructors
// do not count. A copied 13-line function came to only 67 tokens, so 80 tokens missed it.
const MIN_CLONE_LINES = 10
const MIN_CLONE_TOKENS = 50

const cloneSideSchema = z.object({ name: z.string(), start: z.number().int(), end: z.number().int() })
const jscpdReportSchema = z.object({
  duplicates: z.array(z.object({ firstFile: cloneSideSchema, secondFile: cloneSideSchema })),
})

export interface CloneSide {
  readonly path: string
  readonly start: number
  readonly end: number
}
export type Clone = readonly [CloneSide, CloneSide]

export function jscpdArgs(outputDir: string): string[] {
  return [".", "--reporters", "json", "--output", outputDir, "--silent", "--no-gitignore", "--min-lines", String(MIN_CLONE_LINES), "--min-tokens", String(MIN_CLONE_TOKENS)]
}

export function parseJscpdReport(report: string): Clone[] {
  return jscpdReportSchema.parse(JSON.parse(report)).duplicates.map(({ firstFile, secondFile }) => [
    { path: firstFile.name, start: firstFile.start, end: firstFile.end },
    { path: secondFile.name, start: secondFile.start, end: secondFile.end },
  ])
}
