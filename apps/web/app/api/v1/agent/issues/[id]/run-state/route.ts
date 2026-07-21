import * as issuesService from "@gentic/services/issues"
import type { Json } from "@gentic/supabase/types"

import {
  ApiError,
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
          p_pr_url: fields.pr_url ?? undefined,
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

    const { active_run_id: activeRunId, ...stateFields } =
      runStateSchema.parse(body)
    const hasStateFields = Object.keys(stateFields).length > 0
    const { data, error } = hasStateFields
      ? await supabase
          .rpc("patch_issue_run_state", {
            p_issue_id: id,
            p_run_id: activeRunId,
            p_fields: stateFields as Json,
          })
          .single<boolean>()
      : await supabase
          .rpc("touch_issue_run", {
            p_issue_id: id,
            p_run_id: activeRunId,
          })
          .single<boolean>()

    if (error) {
      throw new Error(error.message)
    }
    if (!data) {
      throw new ApiError(409, "Run is no longer active")
    }

    if (stateFields.pr_url) {
      await issuesService.attachIssuePullRequest(
        supabase,
        id,
        stateFields.pr_url
      )
    }

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
