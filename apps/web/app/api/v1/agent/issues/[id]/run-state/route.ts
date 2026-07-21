import * as issuesService from "@gentic/services/issues"
import type { IssueStatus } from "@gentic/validators/issues"

import { resolvePrFinishStatus } from "@/lib/ci-status"

import {
  ensureIssueOwned,
  finishRunSchema,
  getAgentContext,
  handleAgentError,
  json,
  runStateSchema,
} from "../../../_lib"

export const runtime = "nodejs"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { supabase, userId } = await getAgentContext(request)

    await ensureIssueOwned(supabase, userId, id)

    if (
      body &&
      typeof body === "object" &&
      "finish_if_no_pending" in body
    ) {
      const fields = finishRunSchema.parse(body)

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
          p_status: status,
          p_run_finished_at: fields.run_finished_at,
          p_pr_url: fields.pr_url ?? undefined,
        })
        .single<boolean>()

      if (error) {
        throw new Error(error.message)
      }

      if (data && fields.pr_url) {
        await issuesService.attachIssuePullRequest(supabase, id, fields.pr_url)
      }

      return json({ finished: data ?? false, status })
    }

    const fields = runStateSchema.parse(body)
    const { error } = await supabase
      .from("issues")
      .update({
        ...fields,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)

    if (error) {
      throw new Error(error.message)
    }

    if (fields.pr_url) {
      await issuesService.attachIssuePullRequest(supabase, id, fields.pr_url)
    }

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
