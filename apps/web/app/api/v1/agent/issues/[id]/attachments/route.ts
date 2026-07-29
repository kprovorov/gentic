import {
  ensureActiveWorkerRun,
  ensureIssueOwned,
  getAgentContext,
  handleAgentError,
  json,
} from "../../../_lib"

export const runtime = "nodejs"

const ATTACHMENTS_BUCKET = "attachments"
const SIGNED_URL_TTL_SECONDS = 300

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = new URL(request.url).searchParams
    const messageId = searchParams.get("message_id")
    const runId = searchParams.get("run_id")
    const { supabase, userId, workerId } = await getAgentContext(request)

    await ensureIssueOwned(supabase, userId, id)
    if (!runId) {
      return json({ error: "Missing run_id" }, { status: 400 })
    }
    await ensureActiveWorkerRun(supabase, userId, workerId, id, runId)

    let query = supabase
      .from("attachments")
      .select("id,file_name,content_type,size_bytes,storage_path")
      .eq("issue_id", id)
      .is("deleted_at", null)
      .not("upload_completed_at", "is", null)
      .order("created_at", { ascending: true })

    if (messageId) {
      query = query.eq("message_id", messageId)
    } else {
      query = query.is("message_id", null)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(error.message)
    }

    const attachments = await Promise.all(
      (data ?? []).map(async (attachment) => {
        const { data: signed, error: signError } = await supabase.storage
          .from(ATTACHMENTS_BUCKET)
          .createSignedUrl(attachment.storage_path, SIGNED_URL_TTL_SECONDS)

        if (signError) {
          throw new Error(signError.message)
        }

        return {
          id: attachment.id,
          fileName: attachment.file_name,
          contentType: attachment.content_type,
          sizeBytes: attachment.size_bytes,
          url: signed.signedUrl,
        }
      })
    )

    return json({ attachments })
  } catch (error) {
    return handleAgentError(error)
  }
}
