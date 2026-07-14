import * as issuesService from "@gentic/services/issues"

import {
  ApiError,
  ensureIssueOwned,
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
    const fields = runStateSchema.parse(await request.json())
    const { supabase, userId } = await getAgentContext(request)
    const { run_id: runId, ...stateFields } = fields

    await ensureIssueOwned(supabase, userId, id)

    if (Object.keys(stateFields).length === 0) {
      const { data: ok, error } = await supabase.rpc("touch_issue_run", {
        p_issue_id: id,
        p_run_id: runId,
      })

      if (error) {
        throw new Error(error.message)
      }
      if (!ok) {
        throw new ApiError(409, "Run is no longer active")
      }

      return json({ ok: true })
    }

    const { data: ok, error } = await supabase.rpc("patch_issue_run_state", {
      p_issue_id: id,
      p_run_id: runId,
      p_fields: stateFields,
    })

    if (error) {
      throw new Error(error.message)
    }
    if (!ok) {
      throw new ApiError(409, "Run is no longer active")
    }

    if (fields.pr_url) {
      await issuesService.attachIssuePullRequest(supabase, id, fields.pr_url)
    }

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
