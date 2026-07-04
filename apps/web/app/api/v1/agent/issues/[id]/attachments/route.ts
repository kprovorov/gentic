import {
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
    const { supabase, userId } = await getAgentContext(request)

    await ensureIssueOwned(supabase, userId, id)

    const { data, error } = await supabase
      .from("attachments")
      .select("id,file_name,content_type,size_bytes,storage_path")
      .eq("issue_id", id)
      .order("created_at", { ascending: true })
      .returns<
        Array<{
          id: string
          file_name: string
          content_type: string | null
          size_bytes: number | null
          storage_path: string
        }>
      >()

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
