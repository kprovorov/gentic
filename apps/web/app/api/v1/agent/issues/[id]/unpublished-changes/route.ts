import * as issuesService from "@gentic/services/issues"

import {
  ensureActiveHostRun,
  getAgentContext,
  handleAgentError,
  json,
  unpublishedChangesSchema,
  type Supabase,
} from "../../../_lib"

export const runtime = "nodejs"

export async function recordIssueUnpublishedChanges(
  supabase: Supabase,
  userId: string,
  hostId: string,
  issueId: string,
  body: unknown
) {
  const fields = unpublishedChangesSchema.parse(body)
  await ensureActiveHostRun(
    supabase,
    userId,
    hostId,
    issueId,
    fields.active_run_id
  )

  await issuesService.recordUnpublishedAgentChanges(
    supabase,
    userId,
    issueId,
    fields.active_run_id,
    fields.has_unpublished_agent_changes
  )

  return { ok: true as const }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { supabase, userId, hostId } = await getAgentContext(request)

    return json(
      await recordIssueUnpublishedChanges(supabase, userId, hostId, id, body)
    )
  } catch (error) {
    return handleAgentError(error)
  }
}
