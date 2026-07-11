import * as issuesService from "@gentic/services/issues"

import {
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

    await ensureIssueOwned(supabase, userId, id)

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
