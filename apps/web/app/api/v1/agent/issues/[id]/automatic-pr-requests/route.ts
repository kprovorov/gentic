import * as issuesService from "@gentic/services/issues"

import {
  automaticPrPublishRequestSchema,
  getAgentContext,
  handleAgentError,
  json,
  type Supabase,
} from "../../../_lib"

export const runtime = "nodejs"

export async function requestIssueAutomaticPrPublish(
  supabase: Supabase,
  userId: string,
  issueId: string,
  body: unknown
) {
  const fields = automaticPrPublishRequestSchema.parse(body)

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
    const { supabase, userId } = await getAgentContext(request)

    return json(
      await requestIssueAutomaticPrPublish(supabase, userId, id, body)
    )
  } catch (error) {
    return handleAgentError(error)
  }
}
