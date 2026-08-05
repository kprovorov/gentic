import * as issuesService from "@gentic/services/issues"
import type { IssueStatus } from "@gentic/validators/issues"

import { resolvePrFinishStatus } from "@/lib/ci-status"
import { backfillAttachedPullRequestState } from "@/lib/pull-request-state"

import {
  ensureIssueOwned,
  finishRunSchema,
  getAgentContext,
  handleAgentError,
  json,
  runStateSchema,
  ensureActiveWorkerRun,
} from "../../../_lib"

export const runtime = "nodejs"

// Attaches the PR and, only when the row was freshly inserted, resolves its
// pill state so it doesn't sit at "status unavailable" until the first
// `pull_request` webhook lands. Gating on the insert keeps this to one GitHub
// call per PR — the worker re-sends `pr_url` on every run-state update, but
// `attachIssuePullRequest` returns no row on a duplicate.
async function attachPullRequestAndBackfillState(
  supabase: Awaited<ReturnType<typeof getAgentContext>>["supabase"],
  userId: string,
  issueId: string,
  prUrl: string
) {
  const inserted = await issuesService.attachIssuePullRequest(
    supabase,
    issueId,
    prUrl
  )
  if (inserted.length === 0) {
    return
  }

  const repo = await issuesService.getIssueRepo(supabase, issueId)
  await backfillAttachedPullRequestState(supabase, userId, repo, prUrl)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { supabase, userId, workerId } = await getAgentContext(request)

    await ensureIssueOwned(supabase, userId, id)

    if (
      body &&
      typeof body === "object" &&
      "finish_if_no_pending" in body
    ) {
      const fields = finishRunSchema.parse(body)
      await ensureActiveWorkerRun(
        supabase,
        userId,
        workerId,
        id,
        fields.active_run_id
      )

      // `finish_issue_run_if_no_pending` only accepts the two statuses a
      // run can natively finish into. CI-gating resolves to a status the RPC
      // doesn't know about (`testing`), so it's applied as a guarded
      // follow-up update rather than widening the RPC's allow-list.
      let status: IssueStatus = fields.status
      if (status === "ready-for-review" && fields.pr_url) {
        const repo = await issuesService.getIssueRepo(supabase, id)
        if (repo) {
          status = await resolvePrFinishStatus(
            supabase,
            userId,
            repo,
            fields.pr_url
          )
        }
      }

      const { data, error } = await supabase
        .rpc("finish_issue_run_if_no_pending", {
          p_issue_id: id,
          p_run_id: fields.active_run_id,
          p_status: fields.status,
          p_run_finished_at: fields.run_finished_at,
          p_pr_url: fields.pr_url ?? undefined,
        })
        .single<boolean>()

      if (error) {
        throw new Error(error.message)
      }

      if (data && fields.pr_url) {
        await attachPullRequestAndBackfillState(
          supabase,
          userId,
          id,
          fields.pr_url
        )
      }

      if (data && status !== fields.status) {
        await supabase
          .from("issues")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("id", id)
          .eq("status", fields.status)
      }

      return json({ finished: data ?? false, status })
    }

    // Statuses that end a run (`run-failed`, `held`) are written here like any
    // other field. The `issues_release_run_lease` trigger clears
    // `active_run_id`/`active_worker_id` for them, so a dead run stops counting
    // against the worker's capacity and the issue stays re-claimable.
    const fields = runStateSchema.parse(body)
    await ensureActiveWorkerRun(
      supabase,
      userId,
      workerId,
      id,
      fields.active_run_id
    )
    const { data: updatedIssue, error } = await supabase
      .from("issues")
      .update({
        ...Object.fromEntries(
          Object.entries(fields).filter(([key]) => key !== "active_run_id")
        ),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("active_worker_id", workerId)
      .eq("active_run_id", fields.active_run_id)
      .select("id")
      .maybeSingle()
      .returns<{ id: string } | null>()

    if (error) {
      throw new Error(error.message)
    }
    if (!updatedIssue) {
      return json(
        { error: "Run is not active for this worker" },
        { status: 409 }
      )
    }

    if (fields.pr_url) {
      await attachPullRequestAndBackfillState(supabase, userId, id, fields.pr_url)
    }

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
