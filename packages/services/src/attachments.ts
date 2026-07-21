import { ServiceError } from "./errors"

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_PROMPT_ATTACHMENT_BYTES = 50 * 1024 * 1024

export type AttachmentFileLike = {
  name: string
  size: number
}

export type RollbackAttachment = {
  id: string
  storage_path: string
}

export type MessageAttachmentRollbackOps = {
  listAttachments(
    issueId: string,
    messageId: string
  ): Promise<RollbackAttachment[]>
  removeStorageObjects(storagePaths: string[]): Promise<void>
  markAttachmentsDeleted(
    attachmentIds: string[],
    storageDeletedAt: string | null
  ): Promise<void>
  deleteMessage(issueId: string, messageId: string): Promise<void>
}

export function validateAttachmentBatch(files: AttachmentFileLike[]) {
  let totalBytes = 0
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new ServiceError("validation", `"${file.name}" is larger than 25MB`)
    }
    totalBytes += file.size
  }

  if (totalBytes > MAX_PROMPT_ATTACHMENT_BYTES) {
    throw new ServiceError(
      "validation",
      "Attachments for one prompt cannot exceed 50MB"
    )
  }
}

export async function rollbackMessageAttachmentUpload(
  ops: MessageAttachmentRollbackOps,
  issueId: string,
  messageId: string
) {
  const attachments = await ops.listAttachments(issueId, messageId)
  const storagePaths = attachments.map((attachment) => attachment.storage_path)
  const attachmentIds = attachments.map((attachment) => attachment.id)
  let storageDeletedAt: string | null = null

  if (storagePaths.length > 0) {
    try {
      await ops.removeStorageObjects(storagePaths)
      storageDeletedAt = new Date().toISOString()
    } catch {
      storageDeletedAt = null
    }
  }

  if (attachmentIds.length > 0) {
    await ops.markAttachmentsDeleted(attachmentIds, storageDeletedAt)
  }

  await ops.deleteMessage(issueId, messageId)
}
