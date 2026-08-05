import { ServiceError } from "./errors"

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_PROMPT_ATTACHMENT_BYTES = 50 * 1024 * 1024

/**
 * An attachment is owned either by the issue or by a single chat message, and
 * the two ownerships behave differently on purpose:
 *
 * - `issue` — uploaded from the creation form or the standalone attachment
 *   panel. It has no message, is never delivered as part of one turn's
 *   payload, and survives agent/conversation resets.
 * - `message` — uploaded from the chat composer. It rides along with that
 *   message's prompt turn and is reclaimed once the message is gone.
 */
export const ISSUE_ATTACHMENT_KIND = "issue"
export const MESSAGE_ATTACHMENT_KIND = "message"

export type AttachmentKind =
  typeof ISSUE_ATTACHMENT_KIND | typeof MESSAGE_ATTACHMENT_KIND

export type AttachmentOwner =
  | { kind: typeof ISSUE_ATTACHMENT_KIND }
  | { kind: typeof MESSAGE_ATTACHMENT_KIND; messageId: string }

/**
 * The `attachments` columns that decide ownership. Turning a `messageId` into
 * these fields is the single place the two kinds are told apart on write, so
 * no call site can accidentally create a Message Attachment with no message
 * (which the orphan sweeper would reclaim) or an Issue Attachment that owns a
 * message row.
 */
export function attachmentOwnerColumns(owner: AttachmentOwner): {
  kind: AttachmentKind
  message_id: string | null
} {
  return owner.kind === ISSUE_ATTACHMENT_KIND
    ? { kind: ISSUE_ATTACHMENT_KIND, message_id: null }
    : { kind: MESSAGE_ATTACHMENT_KIND, message_id: owner.messageId }
}

export function attachmentOwnerForMessage(
  messageId: string | null
): AttachmentOwner {
  return messageId === null
    ? { kind: ISSUE_ATTACHMENT_KIND }
    : { kind: MESSAGE_ATTACHMENT_KIND, messageId }
}

export type AttachmentOwnershipRow = {
  kind: string
  message_id: string | null
  upload_completed_at: string | null
  deleted_at: string | null
}

/**
 * Durable Issue Attachments to show in the attachment panel: everything the
 * issue owns whose upload finished and which has not been deleted. Message
 * Attachments never appear here, not even the ones whose message was wiped by
 * a reset — those are already on their way out.
 */
export function selectIssueAttachments<T extends AttachmentOwnershipRow>(
  attachments: T[]
): T[] {
  return attachments.filter(
    (attachment) =>
      attachment.kind === ISSUE_ATTACHMENT_KIND &&
      attachment.deleted_at === null &&
      attachment.upload_completed_at !== null
  )
}

/**
 * Message Attachments keyed by the message they were sent with. Deleted rows
 * are kept so the transcript can still show what was delivered at the time;
 * uploads that never completed are dropped because they were never delivered.
 */
export function groupMessageAttachments<T extends AttachmentOwnershipRow>(
  attachments: T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>()

  for (const attachment of attachments) {
    if (attachment.kind !== MESSAGE_ATTACHMENT_KIND) {
      continue
    }
    if (attachment.message_id === null) {
      continue
    }
    if (
      attachment.upload_completed_at === null &&
      attachment.deleted_at === null
    ) {
      continue
    }

    grouped.set(attachment.message_id, [
      ...(grouped.get(attachment.message_id) ?? []),
      attachment,
    ])
  }

  return grouped
}

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
