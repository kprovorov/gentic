import { createServiceClient } from "@gentic/supabase/service"
import type { Supabase } from "@gentic/services/types"

import type { Attachment } from "./[code]/attachments"
import { ATTACHMENTS_BUCKET } from "./attachment-uploads"

const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 3600
const ATTACHMENT_THUMBNAIL_SIZE = 96

/**
 * How many bytes we are willing to hand the browser purely to paint a preview
 * when Storage will not resize the image for us (see {@link signAttachment}).
 * Screenshots and phone photos sit far below this, so the ceiling only spares
 * a client the rare multi-megabyte download that would cost more than the
 * preview is worth.
 */
const MAX_FULL_SIZE_THUMBNAIL_BYTES = 5 * 1024 * 1024

export type SignableAttachment = {
  id: string
  file_name: string
  content_type: string | null
  size_bytes: number | null
  storage_path: string
  deleted_at: string | null
}

/**
 * Mint a signer for one request's attachments.
 *
 * Signing runs on the **secret-key client**, so the caller must have already
 * authorized every row it passes in — in practice by reading it through the
 * Clerk-scoped client, where RLS on `attachments` (via `issues → projects`)
 * has already filtered out anything the user does not own. Signing a path the
 * caller has proven ownership of hands back bytes the user is entitled to
 * read, which is the same trade the MCP `download_attachment` tool makes.
 *
 * That trust boundary is deliberate rather than incidental. The session client
 * can only sign these objects if the `storage.objects` policies mirror the
 * `attachments` table policies exactly, and a drift between the two fails
 * *silently*: `createSignedUrl` returns no URL, the chip loses both its
 * thumbnail and its download link, and it renders as an anonymous file icon
 * that looks like a missing-preview bug rather than a permissions one.
 * Ownership is enforced once, on the read, instead of twice.
 */
export function createAttachmentSigner(
  supabase: Supabase = createServiceClient()
) {
  const storage = supabase.storage.from(ATTACHMENTS_BUCKET)

  return (attachment: SignableAttachment) => signAttachment(storage, attachment)
}

type AttachmentStorage = ReturnType<Supabase["storage"]["from"]>

/**
 * Turn one attachment row into the URLs the UI renders: a download link and,
 * for images, a thumbnail. Deleted rows keep their name and size so the
 * transcript still shows what was sent, but have no bytes left to link to.
 *
 * Thumbnails prefer a resized URL, which keeps the payload proportional to the
 * ~34-48px box the chip draws it into. Resizing needs Storage Image
 * Transformations, which a project may not have (they are a paid add-on, and
 * `supabase/config.toml` leaves them off locally) — there, fall back to the
 * full-size URL and let the browser scale it, rather than dropping every image
 * attachment to a generic file icon.
 *
 * Signing failures are logged rather than swallowed, because an attachment
 * that quietly loses both URLs is indistinguishable in the UI from one that
 * simply has no preview.
 */
async function signAttachment(
  storage: AttachmentStorage,
  attachment: SignableAttachment
): Promise<Attachment> {
  const identity = {
    id: attachment.id,
    fileName: attachment.file_name,
    sizeBytes: attachment.size_bytes,
  }

  if (attachment.deleted_at) {
    return { ...identity, url: null, thumbnailUrl: null }
  }

  const isImage = attachment.content_type?.startsWith("image/") ?? false
  const [download, thumbnail] = await Promise.all([
    storage.createSignedUrl(
      attachment.storage_path,
      ATTACHMENT_SIGNED_URL_TTL_SECONDS
    ),
    isImage
      ? storage.createSignedUrl(
          attachment.storage_path,
          ATTACHMENT_SIGNED_URL_TTL_SECONDS,
          {
            transform: {
              width: ATTACHMENT_THUMBNAIL_SIZE,
              height: ATTACHMENT_THUMBNAIL_SIZE,
              resize: "cover",
            },
          }
        )
      : null,
  ])

  if (download.error) {
    console.error(
      `Failed to sign attachment ${attachment.id}:`,
      attachment.storage_path,
      download.error.message
    )
  }
  if (thumbnail?.error) {
    console.error(
      `Failed to sign thumbnail for attachment ${attachment.id}:`,
      thumbnail.error.message
    )
  }

  const url = download.data?.signedUrl ?? null
  const fullSizeIsAffordable =
    isImage && (attachment.size_bytes ?? 0) <= MAX_FULL_SIZE_THUMBNAIL_BYTES

  return {
    ...identity,
    url,
    thumbnailUrl:
      thumbnail?.data?.signedUrl ?? (fullSizeIsAffordable ? url : null),
  }
}
