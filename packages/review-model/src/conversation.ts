import { z } from "zod"

export const ReviewEvent = { Comment: "comment", Approve: "approve", RequestChanges: "requestChanges" } as const
export type ReviewEvent = (typeof ReviewEvent)[keyof typeof ReviewEvent]

const MAX_COMMENT_CHARS = 60_000
const lineSchema = z.number().int().positive()

export const reviewCommentSchema = z.object({
  path: z.string().min(1),
  /** The file's previous path when it was renamed. GitLab needs both. */
  previousPath: z.string().min(1),
  /** A line this PR added. Null when there's none to attach to, so it goes in the review's text. */
  line: lineSchema.nullable(),
  /** What the comment is about, used when it can't sit on a line. */
  label: z.string(),
  body: z.string().trim().min(1).max(MAX_COMMENT_CHARS),
})
export type ReviewComment = z.infer<typeof reviewCommentSchema>

/** What a reviewer submits. `headSha` is the commit they read, so a newer push can't be approved unseen. */
export const submitReviewSchema = z
  .object({
    event: z.enum(ReviewEvent),
    body: z.string().trim().max(MAX_COMMENT_CHARS),
    headSha: z.string().min(1),
    comments: z.array(reviewCommentSchema).readonly(),
  })
  .superRefine((review, context) => {
    if (review.event === ReviewEvent.RequestChanges && review.body === "" && review.comments.length === 0) {
      context.addIssue({ code: "custom", path: ["body"], message: "Say what needs to change" })
    }
    if (review.event === ReviewEvent.Comment && review.body === "" && review.comments.length === 0) {
      context.addIssue({ code: "custom", path: ["body"], message: "Add a comment first" })
    }
  })
export type SubmitReview = z.infer<typeof submitReviewSchema>

export const replySchema = z.object({ body: z.string().trim().min(1).max(MAX_COMMENT_CHARS) })
export const resolveThreadSchema = z.object({ resolved: z.boolean() })

export const ReviewerState = { Approved: "approved", ChangesRequested: "changesRequested", Commented: "commented", Other: "other" } as const
export type ReviewerState = (typeof ReviewerState)[keyof typeof ReviewerState]

export const threadCommentSchema = z.object({ author: z.string(), body: z.string(), createdAt: z.string(), url: z.string().nullable() })
export type ThreadComment = z.infer<typeof threadCommentSchema>

export const reviewThreadSchema = z.object({
  id: z.string().min(1),
  path: z.string().nullable(),
  /** Null when the code it was on has since changed, or it isn't on a line. */
  line: lineSchema.nullable(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  comments: z.array(threadCommentSchema).readonly(),
})
export type ReviewThread = z.infer<typeof reviewThreadSchema>

/** The discussion as the host has it now. The host stays the record; Walkdiff never stores this. */
export const conversationSchema = z.object({
  reviewers: z.array(z.object({ name: z.string(), state: z.enum(ReviewerState) })).readonly(),
  threads: z.array(reviewThreadSchema).readonly(),
  /** True when the host had more than Walkdiff read. */
  truncated: z.boolean(),
})
export type Conversation = z.infer<typeof conversationSchema>

export const submitResultSchema = z.object({ url: z.string() })
export type SubmitResult = z.infer<typeof submitResultSchema>
