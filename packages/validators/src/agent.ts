import { z } from "zod"

import {
  chatEventPayloadSchema,
  chatEventStatusSchema,
  chatEventTypeSchema,
  chatMessageKindSchema,
  chatMessageStatusSchema,
} from "./chat-events.js"
import {
  agentProviderSchema,
  issueModelSchema,
  issueStatusSchema,
} from "./issues.js"
import { realtimeRunStateStatusSchema } from "./realtime.js"

export type { RealtimeRunStateStatus } from "./realtime.js"

export const claimIssueInputSchema = z.object({}).passthrough()

export type ClaimIssueInput = z.infer<typeof claimIssueInputSchema>

export const claimedIssueSchema = z
  .object({
    id: z.string().uuid(),
    activeRunId: z.string().uuid(),
    code: z.string(),
    title: z.string().nullable(),
    agentProvider: agentProviderSchema,
    issueModel: issueModelSchema,
    repo: z.string(),
    setupScript: z.string().nullable(),
    sessionId: z.string().nullable(),
    branchName: z.string(),
    createPrAutomatically: z.boolean(),
    hasUnpublishedAgentChanges: z.boolean(),
  })
  .strict()

export type ClaimedIssue = z.infer<typeof claimedIssueSchema>

export const claimIssueResponseSchema = z.object({
  issue: claimedIssueSchema.nullable(),
})

const runStateFieldsBaseSchema = z
  .object({
    active_run_id: z.string().uuid(),
    status: realtimeRunStateStatusSchema.optional(),
    session_id: z.string().nullable().optional(),
    run_error: z.string().nullable().optional(),
    run_started_at: z.string().datetime().nullable().optional(),
    run_finished_at: z.string().datetime().nullable().optional(),
    usage_limit_reset_at: z.string().datetime().nullable().optional(),
  })
  .strict()

export const runStateFieldsSchema = runStateFieldsBaseSchema.refine((value) =>
  Object.keys(value).some((key) => key !== "active_run_id")
)

export type RunStateFields = z.infer<typeof runStateFieldsSchema>

export const finishRunFieldsSchema = runStateFieldsBaseSchema
  .extend({
    active_run_id: z.string().uuid(),
    status: realtimeRunStateStatusSchema.extract([
      "ready-for-review",
      "waiting-for-input",
    ]),
    run_finished_at: z.string().datetime(),
  })
  .strict()

export type FinishRunFields = z.infer<typeof finishRunFieldsSchema>

export const okResponseSchema = z.object({
  ok: z.literal(true),
})

export const finishRunResponseSchema = z.object({
  finished: z.boolean(),
  status: issueStatusSchema.optional(),
})

export const ackMessagesInputSchema = z.object({
  run_id: z.string().uuid(),
  message_ids: z.array(z.string().uuid()).min(1),
})

export type AckMessagesInput = z.infer<typeof ackMessagesInputSchema>

export const userMessageSchema = z.object({
  id: z.string().uuid(),
  content: z.string().nullable(),
  created_at: z.string(),
  seq: z.number(),
})

export type UserMessage = z.infer<typeof userMessageSchema>

export const pendingUserMessagesResponseSchema = z.object({
  messages: z.array(userMessageSchema),
})

export const realtimeTokenResponseSchema = z.object({
  url: z.string().url(),
  apiKey: z.string(),
  token: z.string(),
  expiresAt: z.string(),
})

export type RealtimeTokenResponse = z.infer<typeof realtimeTokenResponseSchema>

// Either an implementation-run pair (issue chat) or a `review_run_id` (the
// Review Run log sink) — the two channels are authorized by different RLS
// ownership joins server-side, but share one token-minting route since the
// minted JWT itself is user-scoped, not topic-scoped (see
// `apps/web/lib/realtime-token.ts`).
export const realtimeTokenInputSchema = z.union([
  z
    .object({
      issue_id: z.string().uuid(),
      active_run_id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      review_run_id: z.string().uuid(),
    })
    .strict(),
])

export type RealtimeTokenInput = z.infer<typeof realtimeTokenInputSchema>

export const insertMessageInputShape = {
  id: z.string().uuid(),
  role: z.enum(["assistant", "system"]),
  kind: chatMessageKindSchema.optional(),
  content: z.string(),
  status: chatMessageStatusSchema.optional(),
  author_type: z.enum(["agent", "gentic"]).optional(),
  generated_action: z.enum(["create_pr"]).nullable().optional(),
  event_id: z.string().nullable().optional(),
  run_id: z.string().uuid(),
  event_type: chatEventTypeSchema.nullable().optional(),
  event_status: chatEventStatusSchema.nullable().optional(),
  event_ts: z.string().datetime().nullable().optional(),
  event_seq: z.number().int().positive().nullable().optional(),
  tool_call_id: z.string().nullable().optional(),
  payload: chatEventPayloadSchema.nullable().optional(),
}

export function requireGenticGeneratedActionAuthor<
  T extends {
    author_type?: "agent" | "gentic"
    generated_action?: "create_pr" | null
  },
>(value: T): boolean {
  return (
    value.generated_action === undefined ||
    value.generated_action === null ||
    value.author_type === "gentic"
  )
}

export const insertMessageInputSchema = z
  .object(insertMessageInputShape)
  .refine(requireGenticGeneratedActionAuthor, {
    message: "Generated actions must be Gentic-authored",
    path: ["author_type"],
  })

export type InsertMessageInput = z.infer<typeof insertMessageInputSchema>

export const insertMessageResponseSchema = z.object({
  id: z.string().uuid(),
})

export const automaticPrRequestSchema = z.object({
  id: z.string().uuid(),
  issue_id: z.string().uuid(),
  run_id: z.string().uuid(),
  requested_by_message_id: z.string().uuid().nullable(),
  create_pr_automatically_snapshot: z.boolean(),
  status: z.enum(["pending", "claimed", "completed", "failed", "skipped"]),
  error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type AutomaticPrRequest = z.infer<typeof automaticPrRequestSchema>
export type AutomaticPrRequestStatus = AutomaticPrRequest["status"]

export const recordUnpublishedChangesInputSchema = z.object({
  active_run_id: z.string().uuid(),
  has_unpublished_agent_changes: z.boolean(),
})

export type RecordUnpublishedChangesInput = z.infer<
  typeof recordUnpublishedChangesInputSchema
>

export const requestAutomaticPrPublishInputSchema = z.object({
  active_run_id: z.string().uuid(),
})

export type RequestAutomaticPrPublishInput = z.infer<
  typeof requestAutomaticPrPublishInputSchema
>

// The full issue context a worker needs to keep acting on the same session
// without an extra round trip (e.g. it must not fall back to a
// waiting-for-input transition just to learn the issue's code/title/PR
// state) is echoed back alongside the created (or already-existing, on a
// retried/duplicate call) request and message.
export const automaticPrPublishResponseSchema = z.object({
  requestId: z.string().uuid(),
  messageId: z.string().uuid(),
  created: z.boolean(),
  status: automaticPrRequestSchema.shape.status,
  issue: z.object({
    id: z.string().uuid(),
    code: z.string(),
    title: z.string().nullable(),
    activeRunId: z.string().uuid(),
    createPrAutomatically: z.boolean(),
    hasUnpublishedAgentChanges: z.boolean(),
  }),
})

export type AutomaticPrPublishResponse = z.infer<
  typeof automaticPrPublishResponseSchema
>

export const claimReviewRunInputSchema = z.object({}).passthrough()

export type ClaimReviewRunInput = z.infer<typeof claimReviewRunInputSchema>

export const claimedReviewRunSchema = z
  .object({
    id: z.string().uuid(),
    reviewCycleId: z.string().uuid(),
    issueId: z.string().uuid(),
    pullRequestId: z.string().uuid(),
    headSha: z.string(),
  })
  .strict()

export type ClaimedReviewRun = z.infer<typeof claimedReviewRunSchema>

export const claimReviewRunResponseSchema = z.object({
  reviewRun: claimedReviewRunSchema.nullable(),
})

export const reviewRunHeartbeatInputSchema = z.object({}).passthrough()

export const failReviewRunInputSchema = z
  .object({
    error: z.string().min(1),
  })
  .strict()

export type FailReviewRunInput = z.infer<typeof failReviewRunInputSchema>

export const failReviewRunResponseSchema = z.object({
  retried: z.boolean(),
})

// `evidence`/`impact`/`requestedChange` are required here (unlike the other
// optional fields) because the only caller of `/complete` is the automatic
// reviewer (GEN-415), whose own output schema (`reviewerStructuredOutput
// Schema` below) requires them on every finding it produces.
export const reviewFindingInputSchema = z
  .object({
    severity: z.enum(["info", "warning", "error", "blocker"]).optional(),
    filePath: z.string().nullable().optional(),
    line: z.number().int().positive().nullable().optional(),
    title: z.string(),
    body: z.string().nullable().optional(),
    evidence: z.string().min(1),
    impact: z.string().min(1),
    requestedChange: z.string().min(1),
    githubCommentId: z.number().nullable().optional(),
  })
  .strict()

export type ReviewFindingInput = z.infer<typeof reviewFindingInputSchema>

export const completeReviewRunInputSchema = z
  .object({
    verdict: z.enum(["approved", "changes_requested", "commented"]),
    summary: z.string().nullable().optional(),
    githubReviewId: z.number().nullable().optional(),
    findings: z.array(reviewFindingInputSchema).optional(),
  })
  .strict()

export type CompleteReviewRunInput = z.infer<
  typeof completeReviewRunInputSchema
>

export const completeReviewRunResponseSchema = z.object({
  reviewAttemptId: z.string().uuid().nullable(),
  reviewCycleId: z.string().uuid().nullable(),
  issueId: z.string().uuid().nullable(),
  attemptNumber: z.number().nullable(),
  cycleState: z.string().nullable(),
  accepted: z.boolean(),
})

export type CompleteReviewRunResponse = z.infer<
  typeof completeReviewRunResponseSchema
>

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  contentType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  url: z.string().url(),
})

export type Attachment = z.infer<typeof attachmentSchema>

export const attachmentsResponseSchema = z.object({
  attachments: z.array(attachmentSchema),
})

// The reviewer agent's raw final-message payload (GEN-415): the reviewer is
// instructed to end its turn with exactly one fenced ```json block matching
// this shape. Parsing/validating it happens entirely outside the model —
// there is no MCP tool or other in-band enforcement — so a missing or
// malformed block is treated as an infrastructure failure (`failReviewRun`),
// never a fabricated verdict. Only blocking findings are ever emitted (style/
// preference/speculative feedback is suppressed by the reviewer's own
// instructions), so every finding requires its defect/evidence/impact/
// requestedChange — there is no `severity` field here, unlike the general-
// purpose `reviewFindingInputSchema` findings map into.
export const reviewerFindingSchema = z
  .object({
    defect: z.string().min(1),
    evidence: z.string().min(1),
    impact: z.string().min(1),
    requestedChange: z.string().min(1),
    filePath: z.string().nullable().optional(),
    line: z.number().int().positive().nullable().optional(),
  })
  .strict()

export type ReviewerFinding = z.infer<typeof reviewerFindingSchema>

export const reviewerStructuredOutputSchema = z
  .object({
    verdict: z.enum(["approved", "changes_requested", "commented"]),
    summary: z.string().nullable().optional(),
    findings: z.array(reviewerFindingSchema).default([]),
  })
  .strict()
  // "Blocking-only findings": an approved verdict alongside a nonempty
  // findings list is self-contradictory raw model output, not just an
  // unusual one — treated the same as a malformed block (schema-invalid,
  // infrastructure failure) rather than silently accepted.
  .refine((value) => value.verdict !== "approved" || value.findings.length === 0, {
    message: "An approved verdict must not carry any findings",
    path: ["findings"],
  })

export type ReviewerStructuredOutput = z.infer<
  typeof reviewerStructuredOutputSchema
>

// The full context the isolated reviewer process is given — deliberately
// everything the spec allows and nothing more (no implementation transcript,
// no hidden reasoning). The disposable checkout itself (and the diff
// computed against it) travels out of band, not in this payload — see
// `apps/gentic/src/git.ts`'s `cloneRepoAtSha`/`diffAgainstBase`.
export const reviewRunContextResponseSchema = z.object({
  issue: z.object({
    code: z.string(),
    title: z.string().nullable(),
    body: z.string().nullable(),
  }),
  attachments: z.array(attachmentSchema),
  repo: z.string(),
  reviewerProvider: agentProviderSchema,
  reviewerModel: issueModelSchema,
  reviewerInstructions: z.string().nullable(),
  pullRequest: z.object({
    url: z.string().url(),
    headSha: z.string(),
    ciState: z.enum(["unknown", "pending", "success", "failure"]),
    title: z.string().nullable(),
    body: z.string().nullable(),
    baseRef: z.string().nullable(),
    baseSha: z.string().nullable(),
  }),
})

export type ReviewRunContext = z.infer<typeof reviewRunContextResponseSchema>

// `seq` is assigned client-side by the worker (a single incrementing counter
// per review run, mirroring the `eventSeq` pattern `session.ts`'s `runTurn`
// already uses for Issue chat) rather than computed server-side — a review
// run has exactly one worker appending to it at a time, so there's no
// concurrent-writer race to resolve.
export const reviewRunLogInputSchema = z
  .object({
    seq: z.number().int().positive(),
    role: z.enum(["assistant", "system"]),
    content: z.string().min(1),
  })
  .strict()

export type ReviewRunLogInput = z.infer<typeof reviewRunLogInputSchema>
