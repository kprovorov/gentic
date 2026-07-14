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
  deleteIssueRelationSchema,
  issueStatusSchema,
  sendIssueMessageSchema,
  updateIssueAgentProviderSchema,
  updateIssueSchema,
  type IssueStatus,
} from "@gentic/validators/issues"

import {
  rollbackMessageAttachmentUpload,
  validateAttachmentBatch,
} from "@gentic/services/attachments"
import * as issuesService from "@gentic/services/issues"
import { createServiceClient } from "@gentic/supabase/service"

import { getAuthenticatedContext } from "../_lib/auth-context"
import { getString } from "../_lib/form-data"
import { generateIssueTitle } from "./title"
import { generateIssueType } from "./type"

const ATTACHMENTS_BUCKET = "attachments"

const createIssueFormSchema = createIssueSchema
  .omit({ title: true, status: true, type: true })
  .extend({
    prompt: z.string().trim().min(1).max(10_000),
  })

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file"
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file"
}

async function createIssue(status: IssueStatus, formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const fields = createIssueFormSchema.parse({
    project_id: getString(formData, "project_id"),
    prompt: getString(formData, "prompt"),
    agent_provider: getString(formData, "agent_provider") || "claude_code",
  })

  // Save the issue with no title and the default "issue" type right away
  // rather than blocking on the AI Gateway calls — both are generated after
  // the response is sent (via `after`), so they still complete even if the
  // user closes the tab, and the service-role client is used since there's
  // no request-scoped session by then. `issues` is realtime-enabled, so both
  // fields fill in live for anyone still on the page.
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
      fields.prompt
    )

    await uploadIssueAttachments(
      supabase,
      created.id,
      message.id,
      getAttachmentFiles(formData)
    )

    if (status === "todo") {
      await issuesService.updateIssueStatus(supabase, userId, created.id, "todo")
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
    await issuesService.deleteIssue(supabase, userId, created.id).catch(
      (cleanupError) => {
        console.error(`Failed to clean up issue ${created.id}:`, cleanupError)
      }
    )
    throw error
  }

  after(async () => {
    const serviceClient = createServiceClient()

    const [title, type] = await Promise.all([
      generateIssueTitle(fields.prompt).catch((error) => {
        console.error(`Failed to generate title for issue ${created.id}:`, error)
        return fields.prompt.slice(0, 60)
      }),
      generateIssueType(fields.prompt).catch((error) => {
        console.error(`Failed to generate type for issue ${created.id}:`, error)
        return null
      }),
    ])

    await Promise.all([
      issuesService.setIssueTitle(serviceClient, created.id, title),
      type
        ? issuesService
            .setIssueType(serviceClient, created.id, type)
            .catch((error) => {
              console.error(
                `Failed to persist type for issue ${created.id}:`,
                error
              )
            })
        : null,
    ])
  })

  revalidatePath("/home")
  revalidatePath("/issues")
  redirect(`/issues/${created.id}`)
}

export async function saveIssueDraft(formData: FormData) {
  await createIssue("draft", formData)
}

export async function runIssue(formData: FormData) {
  await createIssue("todo", formData)
}

export async function updateIssue(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { id, title, prompt, agent_provider, type } = updateIssueSchema.parse({
    id: getString(formData, "id"),
    title: getString(formData, "title"),
    prompt: getString(formData, "prompt") || undefined,
    agent_provider: getString(formData, "agent_provider") || "claude_code",
    type: getString(formData, "type") || "feature",
  })

  await issuesService.updateIssue(supabase, userId, id, {
    id,
    title,
    prompt,
    agent_provider,
    type,
  })

  revalidatePath("/home")
  revalidatePath("/issues")
  revalidatePath(`/issues/${id}`)
  redirect(`/issues/${id}`)
}

export async function deleteIssue(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const id = z.string().uuid().parse(getString(formData, "id"))

  await issuesService.deleteIssue(supabase, userId, id)

  revalidatePath("/home")
  revalidatePath("/issues")
  redirect("/issues")
}

export async function resetIssueAgent(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const id = z.string().uuid().parse(getString(formData, "id"))
  const agentProvider = agentProviderSchema.parse(
    getString(formData, "agent_provider") || "claude_code"
  )

  await issuesService.resetIssueAgent(supabase, userId, id, agentProvider)

  revalidatePath("/home")
  revalidatePath("/issues")
  revalidatePath(`/issues/${id}`)
}

export async function updateIssueStatus(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const id = z.string().uuid().parse(getString(formData, "id"))
  const status = issueStatusSchema.parse(getString(formData, "status"))

  await issuesService.updateIssueStatus(supabase, userId, id, status)

  revalidatePath("/home")
  revalidatePath("/issues")
  revalidatePath(`/issues/${id}`)
}

export async function updateIssueAgentProvider(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { id, agent_provider } = updateIssueAgentProviderSchema.parse({
    id: getString(formData, "id"),
    agent_provider: getString(formData, "agent_provider"),
  })

  await issuesService.updateIssueAgentProvider(
    supabase,
    userId,
    id,
    agent_provider
  )

  revalidatePath("/home")
  revalidatePath("/issues")
  revalidatePath(`/issues/${id}`)
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

  revalidatePath("/home")
  revalidatePath("/issues")
  revalidatePath(`/issues/${issue_id}`)
}

export async function deleteIssueRelation(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { id, issue_id } = deleteIssueRelationSchema.parse({
    id: getString(formData, "id"),
    issue_id: getString(formData, "issue_id"),
  })

  await issuesService.deleteIssueRelation(supabase, userId, id, issue_id)

  revalidatePath("/home")
  revalidatePath("/issues")
  revalidatePath(`/issues/${issue_id}`)
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

    revalidatePath(`/issues/${issue_id}`)

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

  revalidatePath(`/issues/${issueId}`)
}

function getAttachmentFiles(formData: FormData) {
  return formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0)
}

function validateAttachmentFiles(files: File[]) {
  validateAttachmentBatch(files)
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

    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
      })

    if (uploadError) {
      await cleanupUploadedAttachments(supabase, uploadedPaths, attachmentIds)
      throw new Error(uploadError.message)
    }
    uploadedPaths.push(storagePath)

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
  const { supabase } = await getAuthenticatedContext()
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

  revalidatePath(`/issues/${issue_id}`)
}
