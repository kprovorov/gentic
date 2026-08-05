"use server"

import { randomUUID } from "node:crypto"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { after } from "next/server"
import { z } from "zod"

import {
  addIssueRelationSchema,
  agentProviderSchema,
  createIssueSchema,
  defaultIssuePriority,
  deleteIssueRelationSchema,
  isIssueModelForAgent,
  issueModelSchema,
  issuePrioritySchema,
  issueStatusSchema,
  mutateIssueLabelsSchema,
  sendIssueMessageSchema,
  updateIssueAgentProviderSchema,
  updateIssuePrioritySchema,
  updateIssueSchema,
  type IssueStatus,
} from "@gentic/validators/issues"

import {
  rollbackMessageAttachmentUpload,
  validateAttachmentBatch,
} from "@gentic/services/attachments"
import { ServiceError } from "@gentic/services/errors"
import * as issuesService from "@gentic/services/issues"
import { createServiceClient } from "@gentic/supabase/service"

import { getAuthenticatedContext } from "../_lib/auth-context"
import { getString } from "../_lib/form-data"
import { formatGeneratedIssueTitle } from "./title-format"
import {
  parseCreateIssueFormData,
  parseUpdateIssueFormData,
} from "./form-values"
import { generateIssueMetadata } from "./metadata"
import { fallbackIssueType } from "./type-parser"
import { getIssueHref } from "./urls"

const ATTACHMENTS_BUCKET = "attachments"

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file"
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file"
}

function revalidateIssuePath(issue: Parameters<typeof getIssueHref>[0]) {
  const href = getIssueHref(issue)

  if (href) {
    revalidatePath(href)
  }
}

async function revalidateIssuePathById(
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"],
  userId: string,
  issueId: string
) {
  revalidateIssuePath(await issuesService.getIssue(supabase, userId, issueId))
}

async function createIssue(status: IssueStatus, formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const fields = parseCreateIssueFormData(formData)
  validateIssueModelForAgent(fields.agent_provider, fields.issue_model)

  // Save the issue with no title, the placeholder "issue" type, and the
  // default priority right away rather than blocking on the AI Gateway call —
  // the real title, type, and priority are generated after the response is
  // sent (via `after`), so they still complete even if the user closes the
  // tab, and the service-role client is used since there's no request-scoped
  // session by then. `issues` is realtime-enabled, so all three fields fill
  // in live for anyone still on the page.
  const created = await issuesService.createIssue(
    supabase,
    userId,
    createIssueSchema.parse({ ...fields, status: "draft" })
  )

  let message: { id: string; created_at: string } | null = null

  try {
    message = await issuesService.createIssueUserMessage(
      supabase,
      created.id,
      fields.body
    )

    await uploadIssueAttachments(
      supabase,
      created.id,
      message.id,
      getAttachmentFiles(formData)
    )

    if (status === "todo") {
      await issuesService.startIssueFromDraft(supabase, userId, created.id)
    }
  } catch (error) {
    if (message) {
      const messageId = message.id
      await cleanupFailedMessage(supabase, created.id, messageId).catch(
        (cleanupError) => {
          console.error(
            `Failed to clean up initial message ${messageId}:`,
            cleanupError
          )
        }
      )
    }
    await issuesService
      .deleteIssue(supabase, userId, created.id)
      .catch((cleanupError) => {
        console.error(`Failed to clean up issue ${created.id}:`, cleanupError)
      })
    throw error
  }

  after(async () => {
    const serviceClient = createServiceClient()

    const { title, type, priority } = await generateIssueMetadata(
      fields.body
    ).catch((error) => {
      console.error(
        `Failed to generate metadata for issue ${created.id}:`,
        error
      )
      return {
        title: formatGeneratedIssueTitle(fields.body),
        type: fallbackIssueType(fields.body),
        priority: defaultIssuePriority,
      }
    })

    await Promise.all([
      issuesService.setIssueTitle(serviceClient, created.id, title),
      issuesService
        .setIssueType(serviceClient, created.id, type)
        .catch((error) => {
          console.error(
            `Failed to persist type for issue ${created.id}:`,
            error
          )
        }),
      issuesService
        .setIssuePriority(serviceClient, created.id, priority)
        .catch((error) => {
          console.error(
            `Failed to persist priority for issue ${created.id}:`,
            error
          )
        }),
    ])
  })
  revalidatePath("/issues")
  redirect(getIssueHref(created) ?? "/issues")
}

export async function saveIssueDraft(formData: FormData) {
  await createIssue("draft", formData)
}

export async function runIssue(formData: FormData) {
  await createIssue("todo", formData)
}

export async function updateIssue(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const {
    id,
    title,
    body,
    agent_provider,
    issue_model,
    type,
    priority,
    create_pr_automatically,
  } = parseUpdateIssueFormData(formData)
  validateIssueModelForAgent(agent_provider, issue_model)

  const issue = await issuesService.updateIssue(supabase, userId, id, {
    id,
    title,
    body,
    agent_provider,
    issue_model,
    type,
    priority,
    create_pr_automatically,
  })
  revalidatePath("/issues")
  revalidateIssuePath(issue)
  redirect(getIssueHref(issue) ?? "/issues")
}

export async function updateIssueTitle(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { id, title } = updateIssueSchema
    .pick({ id: true, title: true })
    .parse({
      id: getString(formData, "id"),
      title: getString(formData, "title"),
    })

  const issue = await issuesService.updateIssueTitle(
    supabase,
    userId,
    id,
    title
  )
  revalidatePath("/issues")
  revalidateIssuePath(issue)

  return issue
}

export async function deleteIssue(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const id = z.string().uuid().parse(getString(formData, "id"))

  await issuesService.deleteIssue(supabase, userId, id)
  revalidatePath("/issues")
  redirect("/issues")
}

export async function resetIssueAgent(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const id = z.string().uuid().parse(getString(formData, "id"))
  const agentProvider = agentProviderSchema.parse(
    getString(formData, "agent_provider") || "claude_code"
  )
  const issueModel = getIssueModel(formData)
  validateIssueModelForAgent(agentProvider, issueModel)

  const message = await issuesService.resetIssueAgent(
    supabase,
    userId,
    id,
    agentProvider,
    issueModel
  )
  revalidatePath("/issues")
  await revalidateIssuePathById(supabase, userId, id)

  return message
}

export async function updateIssueStatus(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const id = z.string().uuid().parse(getString(formData, "id"))
  const status = issueStatusSchema.parse(getString(formData, "status"))

  await issuesService.updateIssueStatus(supabase, userId, id, status)
  revalidatePath("/issues")
  await revalidateIssuePathById(supabase, userId, id)
}

export async function updateIssuePriority(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { id, priority } = updateIssuePrioritySchema.parse({
    id: getString(formData, "id"),
    priority: getString(formData, "priority"),
  })

  const issue = await issuesService.updateIssuePriority(
    supabase,
    userId,
    id,
    priority
  )
  revalidatePath("/issues")
  revalidateIssuePath(issue)

  return issue
}

export async function bulkUpdateIssueStatus(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const ids = z.array(z.string().uuid()).min(1).parse(formData.getAll("id"))
  const status = issueStatusSchema.parse(getString(formData, "status"))

  await issuesService.bulkUpdateIssueStatus(supabase, userId, ids, status)
  revalidatePath("/issues")
}

export async function bulkUpdateIssuePriority(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const ids = z.array(z.string().uuid()).min(1).parse(formData.getAll("id"))
  const priority = issuePrioritySchema.parse(getString(formData, "priority"))

  await issuesService.bulkUpdateIssuePriority(supabase, userId, ids, priority)
  revalidatePath("/issues")
}

export async function bulkUpdateIssueAgentProvider(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const ids = z.array(z.string().uuid()).min(1).parse(formData.getAll("id"))
  const agentProvider = agentProviderSchema.parse(
    getString(formData, "agent_provider")
  )

  await issuesService.bulkUpdateIssueAgentProvider(
    supabase,
    userId,
    ids,
    agentProvider
  )
  revalidatePath("/issues")
}

export async function bulkDeleteIssues(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const ids = z.array(z.string().uuid()).min(1).parse(formData.getAll("id"))

  await issuesService.bulkDeleteIssues(supabase, userId, ids)
  revalidatePath("/issues")
}

export async function updateIssueAgentProvider(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { id, agent_provider, issue_model } =
    updateIssueAgentProviderSchema.parse({
      id: getString(formData, "id"),
      agent_provider: getString(formData, "agent_provider"),
      issue_model: getIssueModel(formData),
    })
  validateIssueModelForAgent(agent_provider, issue_model)

  await issuesService.updateIssueAgentProvider(
    supabase,
    userId,
    id,
    agent_provider,
    issue_model
  )
  revalidatePath("/issues")
  await revalidateIssuePathById(supabase, userId, id)
}

export async function addIssueRelation(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { issue_id, related_issue_id, direction } =
    addIssueRelationSchema.parse({
      issue_id: getString(formData, "issue_id"),
      related_issue_id: getString(formData, "related_issue_id"),
      direction: getString(formData, "direction"),
    })

  await issuesService.addIssueRelation(
    supabase,
    userId,
    issue_id,
    related_issue_id,
    direction
  )
  revalidatePath("/issues")
  await revalidateIssuePathById(supabase, userId, issue_id)
}

export async function deleteIssueRelation(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { id, issue_id } = deleteIssueRelationSchema.parse({
    id: getString(formData, "id"),
    issue_id: getString(formData, "issue_id"),
  })

  await issuesService.deleteIssueRelation(supabase, userId, id, issue_id)
  revalidatePath("/issues")
  await revalidateIssuePathById(supabase, userId, issue_id)
}

export async function addIssueLabels(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { issue_ids, label_ids } = mutateIssueLabelsSchema.parse({
    issue_ids: [getString(formData, "issue_id")],
    label_ids: formData.getAll("label_id"),
  })

  await issuesService.addIssueLabels(supabase, userId, issue_ids, label_ids)
  revalidatePath("/issues")
  await revalidateIssuePathById(supabase, userId, issue_ids[0])
}

export async function removeIssueLabels(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { issue_ids, label_ids } = mutateIssueLabelsSchema.parse({
    issue_ids: [getString(formData, "issue_id")],
    label_ids: formData.getAll("label_id"),
  })

  await issuesService.removeIssueLabels(supabase, userId, issue_ids, label_ids)
  revalidatePath("/issues")
  await revalidateIssuePathById(supabase, userId, issue_ids[0])
}

// Bulk counterparts of the pair above: same account-wide assignment
// contract (validate-then-mutate, idempotent, additive-only), but driven
// from the issue-list bulk toolbar across a multi-issue, multi-project
// selection rather than a single issue's label field.
export async function bulkAddIssueLabels(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { issue_ids, label_ids } = mutateIssueLabelsSchema.parse({
    issue_ids: formData.getAll("issue_id"),
    label_ids: formData.getAll("label_id"),
  })

  await issuesService.addIssueLabels(supabase, userId, issue_ids, label_ids)
  revalidatePath("/issues")
}

export async function bulkRemoveIssueLabels(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { issue_ids, label_ids } = mutateIssueLabelsSchema.parse({
    issue_ids: formData.getAll("issue_id"),
    label_ids: formData.getAll("label_id"),
  })

  await issuesService.removeIssueLabels(supabase, userId, issue_ids, label_ids)
  revalidatePath("/issues")
}

export async function sendIssueMessage(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { issue_id, content } = sendIssueMessageSchema.parse({
    issue_id: getString(formData, "issue_id"),
    content: getString(formData, "content"),
  })

  await issuesService.ensureIssueOwned(supabase, userId, issue_id)
  const files = getAttachmentFiles(formData)
  validateAttachmentFiles(files)
  const message = await issuesService.createIssueUserMessage(
    supabase,
    issue_id,
    content
  )

  try {
    const attachments = await uploadIssueAttachments(
      supabase,
      issue_id,
      message.id,
      files
    )
    await issuesService.requeueIssueForUserMessage(supabase, issue_id)

    await revalidateIssuePathById(supabase, userId, issue_id)

    return { ...message, attachments }
  } catch (error) {
    await cleanupFailedMessage(supabase, issue_id, message.id).catch(
      (cleanupError) => {
        console.error(
          `Failed to clean up message ${message.id} after send failure:`,
          cleanupError
        )
      }
    )
    throw error
  }
}

export async function createManualIssuePullRequest(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const issueId = z.string().uuid().parse(getString(formData, "issue_id"))

  try {
    const message = await issuesService.createManualFirstPrPublishMessage(
      supabase,
      userId,
      issueId
    )

    await revalidateIssuePathById(supabase, userId, issueId)

    return {
      ok: true,
      id: message.id,
      created_at: message.created_at,
      content: message.content,
      created: message.created,
    } as const
  } catch (error) {
    if (error instanceof ServiceError) {
      return {
        ok: false,
        error: error.message,
      } as const
    }
    throw error
  }
}

export async function uploadAttachments(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const issueId = z.string().uuid().parse(getString(formData, "issue_id"))
  await issuesService.ensureIssueOwned(supabase, userId, issueId)
  const files = getAttachmentFiles(formData)
  validateAttachmentFiles(files)

  if (files.length === 0) {
    return
  }

  const message = await issuesService.createIssueUserMessage(
    supabase,
    issueId,
    "Attached files."
  )

  try {
    await uploadIssueAttachments(supabase, issueId, message.id, files)
    await issuesService.requeueIssueForUserMessage(supabase, issueId)
  } catch (error) {
    await cleanupFailedMessage(supabase, issueId, message.id).catch(
      (cleanupError) => {
        console.error(
          `Failed to clean up message ${message.id} after upload failure:`,
          cleanupError
        )
      }
    )
    throw error
  }

  await revalidateIssuePathById(supabase, userId, issueId)
}

function getAttachmentFiles(formData: FormData) {
  return formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0)
}

function validateAttachmentFiles(files: File[]) {
  validateAttachmentBatch(files)
}

function getIssueModel(formData: FormData) {
  return issueModelSchema.parse(getString(formData, "issue_model") || null)
}

function validateIssueModelForAgent(
  agentProvider: z.infer<typeof agentProviderSchema>,
  issueModel: z.infer<typeof issueModelSchema>
) {
  if (!isIssueModelForAgent(agentProvider, issueModel)) {
    throw new Error("Selected model is not available for the selected agent")
  }
}

async function uploadIssueAttachments(
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"],
  issueId: string,
  messageId: string,
  files: File[]
): Promise<
  Array<{
    id: string
    fileName: string
    sizeBytes: number | null
    url: null
    thumbnailUrl: null
  }>
> {
  validateAttachmentFiles(files)
  const uploadedPaths: string[] = []
  const attachmentIds: string[] = []
  const attachments: Array<{
    id: string
    fileName: string
    sizeBytes: number | null
    url: null
    thumbnailUrl: null
  }> = []

  for (const file of files) {
    const storagePath = `${issueId}/${randomUUID()}-${sanitizeFileName(file.name)}`

    const { data, error: insertError } = await supabase
      .from("attachments")
      .insert({
        issue_id: issueId,
        message_id: messageId,
        file_name: file.name,
        content_type: file.type || null,
        size_bytes: file.size,
        storage_path: storagePath,
      })
      .select("id")
      .single<{ id: string }>()

    if (insertError) {
      await cleanupUploadedAttachments(supabase, uploadedPaths, attachmentIds)
      throw new Error(insertError.message)
    }

    attachmentIds.push(data.id)
    uploadedPaths.push(storagePath)

    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
      })

    if (uploadError) {
      await cleanupUploadedAttachments(supabase, uploadedPaths, attachmentIds)
      throw new Error(uploadError.message)
    }

    const { error: updateError } = await supabase
      .from("attachments")
      .update({ upload_completed_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("issue_id", issueId)

    if (updateError) {
      await cleanupUploadedAttachments(supabase, uploadedPaths, attachmentIds)
      throw new Error(updateError.message)
    }

    attachments.push({
      id: data.id,
      fileName: file.name,
      sizeBytes: file.size,
      url: null,
      thumbnailUrl: null,
    })
  }

  return attachments
}

async function cleanupUploadedAttachments(
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"],
  storagePaths: string[],
  attachmentIds: string[]
) {
  let storageDeletedAt: string | null = null
  if (storagePaths.length > 0) {
    const { error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .remove(storagePaths)

    if (!error) {
      storageDeletedAt = new Date().toISOString()
    }
  }

  if (attachmentIds.length > 0) {
    await supabase
      .from("attachments")
      .update({
        deleted_at: new Date().toISOString(),
        storage_deleted_at: storageDeletedAt,
      })
      .in("id", attachmentIds)
  }
}

async function cleanupFailedMessage(
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"],
  issueId: string,
  messageId: string
) {
  await rollbackMessageAttachmentUpload(
    {
      async listAttachments(issueId, messageId) {
        const { data } = await supabase
          .from("attachments")
          .select("id,storage_path")
          .eq("issue_id", issueId)
          .eq("message_id", messageId)
          .returns<Array<{ id: string; storage_path: string }>>()

        return data ?? []
      },
      async removeStorageObjects(storagePaths) {
        const { error } = await supabase.storage
          .from(ATTACHMENTS_BUCKET)
          .remove(storagePaths)

        if (error) {
          throw new Error(error.message)
        }
      },
      async markAttachmentsDeleted(attachmentIds, storageDeletedAt) {
        const { error } = await supabase
          .from("attachments")
          .update({
            deleted_at: new Date().toISOString(),
            storage_deleted_at: storageDeletedAt,
          })
          .in("id", attachmentIds)

        if (error) {
          throw new Error(error.message)
        }
      },
      async deleteMessage(issueId, messageId) {
        await issuesService.deleteIssueMessage(supabase, issueId, messageId)
      },
    },
    issueId,
    messageId
  )
}

const deleteAttachmentSchema = z.object({
  id: z.string().uuid(),
  issue_id: z.string().uuid(),
})

export async function deleteAttachment(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { id, issue_id } = deleteAttachmentSchema.parse({
    id: getString(formData, "id"),
    issue_id: getString(formData, "issue_id"),
  })

  const { data: attachment, error: fetchError } = await supabase
    .from("attachments")
    .select("storage_path,deleted_at,storage_deleted_at")
    .eq("id", id)
    .eq("issue_id", issue_id)
    .single<{
      storage_path: string
      deleted_at: string | null
      storage_deleted_at: string | null
    }>()

  if (fetchError) {
    throw new Error(fetchError.message)
  }

  let storageDeletedAt: string | null = null
  if (!attachment.deleted_at) {
    const { error: removeError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .remove([attachment.storage_path])

    if (removeError) {
      throw new Error(removeError.message)
    }
    storageDeletedAt = new Date().toISOString()
  }

  const { error } = await supabase
    .from("attachments")
    .update({
      deleted_at: attachment.deleted_at ?? new Date().toISOString(),
      storage_deleted_at: attachment.storage_deleted_at ?? storageDeletedAt,
    })
    .eq("id", id)
    .eq("issue_id", issue_id)

  if (error) {
    throw new Error(error.message)
  }

  await revalidateIssuePathById(supabase, userId, issue_id)
}
