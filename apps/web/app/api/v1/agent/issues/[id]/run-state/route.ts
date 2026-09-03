import {
  ensureIssueOwned,
  finishRunSchema,
  getAgentContext,
  handleAgentError,
  json,
  runStateSchema,
  ensureActiveHostRun,
  type Supabase,
} from "../../../_lib"

export const runtime = "nodejs"

export async function finishIssueRun(
  supabase: Supabase,
  userId: string,
  hostId: string,
  issueId: string,
  body: unknown
) {
  const fields = finishRunSchema.parse(body)
  await ensureActiveHostRun(
    supabase,
    userId,
    hostId,
    issueId,
    fields.active_run_id
  )

  const { data, error } = await supabase
    .rpc("finish_issue_run_if_no_pending", {
      p_issue_id: issueId,
      p_run_id: fields.active_run_id,
      p_status: fields.status,
      p_run_finished_at: fields.run_finished_at,
    })
    .single<{ finished: boolean; status: string }>()

  if (error) {
    throw new Error(error.message)
  }

  return {
    finished: data?.finished ?? false,
    status: data?.status ?? fields.status,
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { supabase, userId, hostId } = await getAgentContext(request)

    await ensureIssueOwned(supabase, userId, id)

    if (body && typeof body === "object" && "finish_if_no_pending" in body) {
      return json(await finishIssueRun(supabase, userId, hostId, id, body))
    }

    // Statuses that end a run (`run-failed`, `held`) are written here like any
    // other field. The `issues_release_run_lease` trigger clears
    // `active_run_id`/`active_host_id` for them, so a dead run stops counting
    // against the host's capacity and the issue stays re-claimable.
    const fields = runStateSchema.parse(body)
    await ensureActiveHostRun(
      supabase,
      userId,
      hostId,
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
      .eq("active_host_id", hostId)
      .eq("active_run_id", fields.active_run_id)
      .select("id")
      .maybeSingle()
      .returns<{ id: string } | null>()

    if (error) {
      throw new Error(error.message)
    }
    if (!updatedIssue) {
      return json({ error: "Run is not active for this host" }, { status: 409 })
    }

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
