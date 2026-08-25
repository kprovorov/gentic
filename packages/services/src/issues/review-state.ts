import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"
import { ensureIssueOwned } from "./ownership"

// The first user-facing (RLS-scoped) read path into the Automatic Review
// lifecycle tables (GEN-419) — everything in `review-context.ts` is
// worker/service-role-only, built for a different trust boundary. Shaped
// flat (one row per cycle, carrying its `pullRequestId`) rather than nested
// under each pull request, so a caller with several pull requests can group
// by `pullRequestId` and take the newest cycle per group for that PR's
// current gate, while still having the full history available.

export type ReviewFinding = {
  id: string
  severity: string
  filePath: string | null
  line: number | null
  title: string
  body: string | null
  evidence: string | null
  impact: string | null
  requestedChange: string | null
  githubCommentId: number | null
  createdAt: string
}

export type ReviewAttempt = {
  id: string
  attemptNumber: number
  verdict: string
  summary: string | null
  githubReviewId: number | null
  publishedAt: string | null
  createdAt: string
  findings: ReviewFinding[]
}

export type ReviewRun = {
  id: string
  status: string
  error: string | null
  headSha: string
  startedAt: string | null
  finishedAt: string | null
  claimedByWorkerId: string | null
  heartbeatAt: string | null
  createdAt: string
}

export type ReviewCycle = {
  id: string
  pullRequestId: string
  state: string
  headSha: string
  supersededReason: string | null
  createdAt: string
  updatedAt: string
  runs: ReviewRun[]
  attempts: ReviewAttempt[]
}

type ReviewCycleRow = {
  id: string
  pull_request_id: string
  state: string
  head_sha: string
  superseded_reason: string | null
  created_at: string
  updated_at: string
  review_runs: {
    id: string
    status: string
    error: string | null
    head_sha: string
    started_at: string | null
    finished_at: string | null
    claimed_by_worker_id: string | null
    heartbeat_at: string | null
    created_at: string
  }[]
  review_attempts: {
    id: string
    attempt_number: number
    verdict: string
    summary: string | null
    github_review_id: number | null
    published_at: string | null
    created_at: string
    review_findings: {
      id: string
      severity: string
      file_path: string | null
      line: number | null
      title: string
      body: string | null
      evidence: string | null
      impact: string | null
      requested_change: string | null
      github_comment_id: number | null
      created_at: string
    }[]
  }[]
}

const REVIEW_CYCLE_SELECT = `
  id, pull_request_id, state, head_sha, superseded_reason, created_at, updated_at,
  review_runs (
    id, status, error, head_sha, started_at, finished_at,
    claimed_by_worker_id, heartbeat_at, created_at
  ),
  review_attempts (
    id, attempt_number, verdict, summary, github_review_id, published_at, created_at,
    review_findings (
      id, severity, file_path, line, title, body, evidence, impact,
      requested_change, github_comment_id, created_at
    )
  )
`

/**
 * Every Automatic Review cycle for an Issue (across all its pull requests),
 * newest first, each with its full run and attempt/findings history.
 */
export async function listReviewStateForIssue(
  supabase: Supabase,
  userId: string,
  issueId: string
): Promise<ReviewCycle[]> {
  await ensureIssueOwned(supabase, userId, issueId)

  const rows = unwrap(
    await supabase
      .from("review_cycles")
      .select(REVIEW_CYCLE_SELECT)
      .eq("issue_id", issueId)
      .order("created_at", { ascending: false })
      .returns<ReviewCycleRow[]>()
  )

  return rows.map(toReviewCycle)
}

function toReviewCycle(row: ReviewCycleRow): ReviewCycle {
  return {
    id: row.id,
    pullRequestId: row.pull_request_id,
    state: row.state,
    headSha: row.head_sha,
    supersededReason: row.superseded_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    runs: row.review_runs
      .toSorted((a, b) => a.created_at.localeCompare(b.created_at))
      .map((run) => ({
        id: run.id,
        status: run.status,
        error: run.error,
        headSha: run.head_sha,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        claimedByWorkerId: run.claimed_by_worker_id,
        heartbeatAt: run.heartbeat_at,
        createdAt: run.created_at,
      })),
    attempts: row.review_attempts
      .toSorted((a, b) => a.attempt_number - b.attempt_number)
      .map((attempt) => ({
        id: attempt.id,
        attemptNumber: attempt.attempt_number,
        verdict: attempt.verdict,
        summary: attempt.summary,
        githubReviewId: attempt.github_review_id,
        publishedAt: attempt.published_at,
        createdAt: attempt.created_at,
        findings: attempt.review_findings.map((finding) => ({
          id: finding.id,
          severity: finding.severity,
          filePath: finding.file_path,
          line: finding.line,
          title: finding.title,
          body: finding.body,
          evidence: finding.evidence,
          impact: finding.impact,
          requestedChange: finding.requested_change,
          githubCommentId: finding.github_comment_id,
          createdAt: finding.created_at,
        })),
      })),
  }
}

export type ReviewRunLog = {
  id: string
  seq: number
  role: string
  content: string
  createdAt: string
}

/**
 * A Review Run's execution log, on demand — deliberately not part of
 * `listReviewStateForIssue`'s payload (see `review_run_logs`' own
 * migration: reviewer execution logs must never leak into Issue chat, and
 * keeping them out of the default page fetch keeps that boundary in the
 * data layer, not just the UI).
 */
export async function listReviewRunLogs(
  supabase: Supabase,
  userId: string,
  issueId: string,
  reviewRunId: string
): Promise<ReviewRunLog[]> {
  await ensureIssueOwned(supabase, userId, issueId)

  const runResult = await supabase
    .from("review_runs")
    .select("id, review_cycles!inner ( issue_id )")
    .eq("id", reviewRunId)
    .maybeSingle()

  const { data: run, error: runError } = runResult as {
    data: { id: string; review_cycles: { issue_id: string } } | null
    error: { message: string } | null
  }

  if (runError) {
    throw new ServiceError("internal", runError.message)
  }
  if (!run || run.review_cycles.issue_id !== issueId) {
    throw new ServiceError("not_found", "Review run not found")
  }

  return unwrap(
    await supabase
      .from("review_run_logs")
      .select("id,seq,role,content,created_at")
      .eq("review_run_id", reviewRunId)
      .order("seq", { ascending: true })
  ).map((log) => ({
    id: log.id,
    seq: log.seq,
    role: log.role,
    content: log.content,
    createdAt: log.created_at,
  }))
}
