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

      const { data, error } = await supabase
        .rpc("finish_issue_run_if_no_pending", {
          p_issue_id: id,
          p_run_id: fields.active_run_id,
          p_status: fields.status,
          p_run_finished_at: fields.run_finished_at,
          p_pr_url: fields.pr_url ?? undefined,
        })
        .single<{ finished: boolean; status: string }>()

      if (error) {
        throw new Error(error.message)
      }

      return json({
        finished: data?.finished ?? false,
        status: data?.status ?? fields.status,
      })
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

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
