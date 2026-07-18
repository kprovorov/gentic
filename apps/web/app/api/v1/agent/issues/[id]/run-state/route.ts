import * as issuesService from "@gentic/services/issues"

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
      const { data, error } = await supabase
        .rpc("finish_issue_run_if_no_pending", {
          p_issue_id: id,
          p_run_id: fields.active_run_id,
          p_status: fields.status,
          p_run_finished_at: fields.run_finished_at,
          p_pr_url: fields.pr_url ?? null,
        })
        .single<boolean>()

      if (error) {
        throw new Error(error.message)
      }

      if (data && fields.pr_url) {
        await issuesService.attachIssuePullRequest(supabase, id, fields.pr_url)
      }

      return json({ finished: data ?? false })
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
