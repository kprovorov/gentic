// Attachment bytes go from the browser straight into Supabase Storage, never
// through a Server Action: an action body is capped at 1MB by default (and at
// 4.5MB by Vercel's request limit regardless of that setting), while a single
// attachment may be 25MB. The actions only ever carry the metadata below, plus
// the signed-upload tickets they hand back.
//
// Shared by both sides of that exchange, so it stays free of "use server" and
// "use client".

export const ATTACHMENTS_BUCKET = "attachments"

export const ATTACHMENT_DESCRIPTORS_FIELD = "attachments"
export const ATTACHMENT_IDS_FIELD = "attachment_id"

/** What the browser tells the server about a file it is about to upload. */
export type AttachmentDescriptor = {
  name: string
  type: string
  size: number
}

/**
 * What the server hands back per declared file: the reserved `attachments` row
 * plus a short-lived credential to PUT the bytes at its storage path.
 */
export type AttachmentUploadTicket = {
  attachmentId: string
  path: string
  token: string
  contentType: string
}

/**
 * The slice of a Supabase client `uploadAttachmentFiles` needs. Structural so
 * this module does not care whether the caller holds a browser client, and so
 * tests can pass a stub.
 */
export type SignedUploadClient = {
  storage: {
    from(bucket: string): {
      uploadToSignedUrl(
        path: string,
        token: string,
        file: File,
        options?: { contentType?: string }
      ): Promise<{ error: { message: string } | null }>
    }
  }
}

export function describeAttachmentFiles(files: File[]): AttachmentDescriptor[] {
  return files.map((file) => ({
    name: file.name,
    type: file.type,
    size: file.size,
  }))
}

/**
 * Attach the metadata for `files` to an action payload. Nothing is written
 * when there are no files, so actions can treat a missing field as "no
 * attachments" rather than having to parse an empty list.
 */
export function appendAttachmentDescriptors(formData: FormData, files: File[]) {
  if (files.length === 0) {
    return
  }

  formData.set(
    ATTACHMENT_DESCRIPTORS_FIELD,
    JSON.stringify(describeAttachmentFiles(files))
  )
}

export function appendAttachmentIds(
  formData: FormData,
  attachmentIds: string[]
) {
  for (const attachmentId of attachmentIds) {
    formData.append(ATTACHMENT_IDS_FIELD, attachmentId)
  }
}

/**
 * Upload each file to the ticket minted for it. Tickets come back in the order
 * the descriptors were sent, so index pairing is what ties a file to its row.
 *
 * Uploads run one at a time: a batch may be 50MB in total and the failure that
 * matters is the first one, since the caller abandons the whole batch anyway.
 */
export async function uploadAttachmentFiles(
  supabase: SignedUploadClient,
  tickets: AttachmentUploadTicket[],
  files: File[]
): Promise<string[]> {
  if (tickets.length !== files.length) {
    throw new Error("Attachment upload tickets do not match the selected files")
  }

  const uploaded: string[] = []

  for (const [index, ticket] of tickets.entries()) {
    const { error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .uploadToSignedUrl(ticket.path, ticket.token, files[index], {
        contentType: ticket.contentType,
      })

    if (error) {
      throw new Error(
        `Could not upload "${files[index].name}": ${error.message}`
      )
    }

    uploaded.push(ticket.attachmentId)
  }

  return uploaded
}
