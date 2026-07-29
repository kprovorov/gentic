import * as issuesService from "@gentic/services/issues"

import {
  automaticPrPublishRequestSchema,
  ensureActiveWorkerRun,
  getAgentContext,
  handleAgentError,
  json,
  type Supabase,
} from "../../../_lib"

export const runtime = "nodejs"

export async function requestIssueAutomaticPrPublish(
  supabase: Supabase,
  userId: string,
  workerId: string,
  issueId: string,
  body: unknown
) {
  const fields = automaticPrPublishRequestSchema.parse(body)
  await ensureActiveWorkerRun(
    supabase,
    userId,
    workerId,
    issueId,
    fields.active_run_id
  )

  const result = await issuesService.requestAutomaticPrPublish(
    supabase,
    userId,
    issueId,
    fields.active_run_id
  )

  return {
    requestId: result.requestId,
    messageId: result.messageId,
    created: result.created,
    status: result.status,
    issue: result.issue,
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { supabase, userId, workerId } = await getAgentContext(request)

    return json(
      await requestIssueAutomaticPrPublish(supabase, userId, workerId, id, body)
    )
  } catch (error) {
    return handleAgentError(error)
  }
}
