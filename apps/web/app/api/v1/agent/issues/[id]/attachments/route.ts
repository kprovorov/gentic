import {
  ISSUE_ATTACHMENT_KIND,
  MESSAGE_ATTACHMENT_KIND,
} from "@gentic/services/attachments"
import {
  ensureActiveWorkerRun,
  ensureIssueOwned,
  getAgentContext,
  handleAgentError,
  json,
  type Supabase,
} from "../../../_lib"

export const runtime = "nodejs"

const ATTACHMENTS_BUCKET = "attachments"
const SIGNED_URL_TTL_SECONDS = 300

type WorkerAttachment = {
  id: string
  fileName: string
  contentType: string | null
  sizeBytes: number | null
  url: string
}

/**
 * Attachments the worker may download for one prompt turn.
 *
 * A `messageId` asks for that message's own uploads; omitting it asks for the
 * issue's durable attachments. The two are matched on `kind`, not just on
 * `message_id`, so a Message Attachment whose message was wiped by a reset is
 * never mistaken for an Issue Attachment.
 */
export async function listWorkerIssueAttachments(
  supabase: Supabase,
  userId: string,
  workerId: string,
  issueId: string,
  { messageId, runId }: { messageId: string | null; runId: string }
): Promise<{ attachments: WorkerAttachment[] }> {
  await ensureIssueOwned(supabase, userId, issueId)
  await ensureActiveWorkerRun(supabase, userId, workerId, issueId, runId)

  let query = supabase
    .from("attachments")
    .select("id,file_name,content_type,size_bytes,storage_path")
    .eq("issue_id", issueId)
    .is("deleted_at", null)
    .not("upload_completed_at", "is", null)
    .order("created_at", { ascending: true })

  if (messageId) {
    query = query
      .eq("kind", MESSAGE_ATTACHMENT_KIND)
      .eq("message_id", messageId)
  } else {
    query = query.eq("kind", ISSUE_ATTACHMENT_KIND).is("message_id", null)
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

  return { attachments }
}

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

    if (!runId) {
      await ensureIssueOwned(supabase, userId, id)
      return json({ error: "Missing run_id" }, { status: 400 })
    }

    return json(
      await listWorkerIssueAttachments(supabase, userId, workerId, id, {
        messageId,
        runId,
      })
    )
  } catch (error) {
    return handleAgentError(error)
  }
}
