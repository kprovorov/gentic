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
  updateIssueTypeSchema,
} from "@gentic/validators/issues"

import {
  attachmentOwnerColumns,
  attachmentOwnerForMessage,
  rollbackMessageAttachmentUpload,
  validateAttachmentBatch,
} from "@gentic/services/attachments"
import { ServiceError } from "@gentic/services/errors"
import * as issuesService from "@gentic/services/issues"
import type { Supabase } from "@gentic/services/types"
import { createServiceClient } from "@gentic/supabase/service"

import { getAuthenticatedContext } from "../_lib/auth-context"
import { getString, getUuid } from "../_lib/form-data"
import type { Attachment } from "./[code]/attachments"
import {
  createAttachmentSigner,
  type SignableAttachment,
} from "./attachment-signing"
import {
  ATTACHMENT_DESCRIPTORS_FIELD,
  ATTACHMENT_IDS_FIELD,
  ATTACHMENTS_BUCKET,
  type AttachmentDescriptor,
  type AttachmentUploadTicket,
} from "./attachment-uploads"
import { formatGeneratedIssueTitle } from "./title-format"
import {
  parseCreateIssueFormData,
  parseUpdateIssueFormData,
} from "./form-values"
import { generateIssueMetadata } from "./metadata"
import { fallbackIssueType } from "./type-parser"
import { getIssueHref } from "./urls"

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
  supabase: Supabase,
  userId: string,
  issueId: string
) {
  revalidateIssuePath(await issuesService.getIssue(supabase, userId, issueId))
}

/**
 * Phase one of creating an issue: everything that does not depend on the
 * attachment bytes having landed. The issue is always born a draft, even for
 * "Run Agent", so a browser that dies mid-upload leaves a draft the user can
 * finish rather than a queued issue whose files never arrived —
 * {@link finishIssueCreation} is what promotes it.
 */
export async function startIssueCreation(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const fields = parseCreateIssueFormData(formData)
  validateIssueModelForAgent(fields.agent_provider, fields.issue_model)
  const descriptors = getAttachmentDescriptors(formData)

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

  let uploads: AttachmentUploadTicket[] = []

  try {
    // The Body lives on the issue row itself (rendered above the timeline by
    // `IssueRequestBody`) and is never copied into a chat message here: doing
    // so used to seed the transcript, but it also left a `role: 'user'`
    // message behind before `startIssueFromDraft` ran, which made that RPC's
    // "no user message yet" idempotency check skip creating the Kickoff
    // Message — so the agent's first prompt was the raw Body instead of
    // `Work on Gentic issue {code}.`.
    uploads = await createAttachmentUploadTickets(
      supabase,
      created.id,
      null,
      descriptors
    )
  } catch (error) {
    await discardIssue(supabase, userId, created.id)
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

  return {
    issueId: created.id,
    href: getIssueHref(created) ?? "/issues",
    uploads,
  }
}

/**
 * Phase two: the bytes are in Storage, so publish the attachments and, for
 * "Run Agent", hand the issue to the queue. Queuing happens last so a worker
 * can never claim an issue whose attachments are still uploading.
 */
export async function finishIssueCreation(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const issueId = getUuid(formData, "issue_id")
  const status = issueStatusSchema.parse(getString(formData, "status"))
  await issuesService.ensureIssueOwned(supabase, userId, issueId)

  await completeAttachmentUploads(supabase, issueId, getAttachmentIds(formData))

  if (status === "todo") {
    await issuesService.startIssueFromDraft(supabase, userId, issueId)
  }

  revalidatePath("/issues")
}

/**
 * Roll back a creation whose uploads failed. The draft is only ever visible to
 * its author for the few seconds the upload takes, so it is deleted outright
 * rather than left behind half-formed.
 */
export async function abandonIssueCreation(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const issueId = getUuid(formData, "issue_id")
  await issuesService.ensureIssueOwned(supabase, userId, issueId)

  await discardIssue(supabase, userId, issueId)
}

async function discardIssue(
  supabase: Supabase,
  userId: string,
  issueId: string
) {
  // The issue's own attachments outlive its messages now, so deleting the
  // issue below would leave their blobs behind without this.
  await cleanupIssueAttachments(supabase, issueId).catch((error) => {
    console.error(`Failed to clean up attachments for issue ${issueId}:`, error)
  })
  await issuesService.deleteIssue(supabase, userId, issueId).catch((error) => {
    console.error(`Failed to clean up issue ${issueId}:`, error)
  })
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
    automatic_review_enabled,
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
    automatic_review_enabled,
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
  const id = getUuid(formData, "id")

  await issuesService.deleteIssue(supabase, userId, id)
  revalidatePath("/issues")
  redirect("/issues")
}

export async function resetIssueAgent(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const id = getUuid(formData, "id")
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
  const id = getUuid(formData, "id")
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

export async function updateIssueType(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { id, type } = updateIssueTypeSchema.parse({
    id: getString(formData, "id"),
    type: getString(formData, "type"),
  })

  const issue = await issuesService.updateIssueType(supabase, userId, id, type)
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

/**
 * Phase one of sending a chat message: persist the turn and reserve its
 * attachments. The issue is deliberately *not* requeued yet — the agent must
 * not wake up to a prompt whose files are still in flight.
 */
export async function startIssueMessage(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { issue_id, content } = sendIssueMessageSchema.parse({
    issue_id: getString(formData, "issue_id"),
    content: getString(formData, "content"),
  })

  await issuesService.ensureIssueOwned(supabase, userId, issue_id)
  const descriptors = getAttachmentDescriptors(formData)
  const message = await issuesService.createIssueUserMessage(
    supabase,
    issue_id,
    content
  )

  try {
    const uploads = await createAttachmentUploadTickets(
      supabase,
      issue_id,
      message.id,
      descriptors
    )

    return { ...message, uploads }
  } catch (error) {
    await discardIssueMessage(supabase, issue_id, message.id)
    throw error
  }
}

/** Phase two: publish the uploaded attachments, then wake the agent. */
export async function finishIssueMessage(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const issueId = getUuid(formData, "issue_id")
  await issuesService.ensureIssueOwned(supabase, userId, issueId)

  const attachments = await completeAttachmentUploads(
    supabase,
    issueId,
    getAttachmentIds(formData)
  )
  await issuesService.requeueIssueForUserMessage(supabase, issueId)

  await revalidateIssuePathById(supabase, userId, issueId)

  return { attachments }
}

/**
 * Roll back a send whose uploads failed, so the composer's retry path starts
 * from a clean transcript instead of a turn the agent never received.
 */
export async function abandonIssueMessage(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const issueId = getUuid(formData, "issue_id")
  const messageId = getUuid(formData, "message_id")
  await issuesService.ensureIssueOwned(supabase, userId, issueId)

  await discardIssueMessage(supabase, issueId, messageId)
}

async function discardIssueMessage(
  supabase: Supabase,
  issueId: string,
  messageId: string
) {
  await cleanupFailedMessage(supabase, issueId, messageId).catch((error) => {
    console.error(
      `Failed to clean up message ${messageId} after send failure:`,
      error
    )
  })
}

export async function createManualIssuePullRequest(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const issueId = getUuid(formData, "issue_id")

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

// The standalone attachment panel adds durable Issue Attachments: no chat
// message is written and the agent is neither requeued nor woken, so parking a
// spec next to an issue is not a way to (re)start a run.
export async function startAttachmentUploads(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const issueId = getUuid(formData, "issue_id")
  await issuesService.ensureIssueOwned(supabase, userId, issueId)

  const uploads = await createAttachmentUploadTickets(
    supabase,
    issueId,
    null,
    getAttachmentDescriptors(formData)
  )

  return { uploads }
}

export async function finishAttachmentUploads(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const issueId = getUuid(formData, "issue_id")
  await issuesService.ensureIssueOwned(supabase, userId, issueId)

  await completeAttachmentUploads(supabase, issueId, getAttachmentIds(formData))

  await revalidateIssuePathById(supabase, userId, issueId)
}

const attachmentDescriptorsSchema = z.array(
  z.object({
    name: z.string().trim().min(1).max(500),
    type: z.string().max(255).default(""),
    size: z.number().int().nonnegative(),
  })
)

function getAttachmentDescriptors(formData: FormData): AttachmentDescriptor[] {
  const raw = getString(formData, ATTACHMENT_DESCRIPTORS_FIELD)

  if (!raw) {
    return []
  }

  const descriptors = attachmentDescriptorsSchema.parse(JSON.parse(raw))

  // Sizes are what the browser *claims*; the authoritative ceiling is the
  // bucket's own 50MB `file_size_limit`, which Storage enforces on the upload
  // the signed ticket authorizes. This check is what turns an over-budget
  // batch into the same readable message the user got before.
  validateAttachmentBatch(descriptors)

  return descriptors.filter((descriptor) => descriptor.size > 0)
}

function getAttachmentIds(formData: FormData) {
  return z
    .array(z.string().uuid())
    .parse(formData.getAll(ATTACHMENT_IDS_FIELD).map(String))
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

/**
 * Reserve one `attachments` row per declared file and mint a signed ticket the
 * browser uses to PUT the bytes into Storage directly.
 *
 * A message id makes these Message Attachments delivered with that prompt
 * turn, `null` makes them durable Issue Attachments owned by the issue itself.
 *
 * The rows land with `upload_completed_at` null, which every read path already
 * treats as "not here yet" (`selectIssueAttachments`, `groupMessageAttachments`,
 * `listIssueAttachments`) and which `delete_old_orphaned_attachments` reclaims
 * a day later — so a browser that never finishes uploading leaves nothing
 * visible behind.
 */
async function createAttachmentUploadTickets(
  supabase: Supabase,
  issueId: string,
  messageId: string | null,
  descriptors: AttachmentDescriptor[]
): Promise<AttachmentUploadTicket[]> {
  const owner = attachmentOwnerColumns(attachmentOwnerForMessage(messageId))
  const reservedPaths: string[] = []
  const attachmentIds: string[] = []
  const tickets: AttachmentUploadTicket[] = []

  for (const descriptor of descriptors) {
    const storagePath = `${issueId}/${randomUUID()}-${sanitizeFileName(descriptor.name)}`

    const { data, error: insertError } = await supabase
      .from("attachments")
      .insert({
        issue_id: issueId,
        ...owner,
        file_name: descriptor.name,
        content_type: descriptor.type || null,
        size_bytes: descriptor.size,
        storage_path: storagePath,
      })
      .select("id")
      .single<{ id: string }>()

    if (insertError) {
      await cleanupUploadedAttachments(supabase, reservedPaths, attachmentIds)
      throw new Error(insertError.message)
    }

    attachmentIds.push(data.id)
    reservedPaths.push(storagePath)

    const { data: signed, error: signError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUploadUrl(storagePath)

    if (signError || !signed) {
      await cleanupUploadedAttachments(supabase, reservedPaths, attachmentIds)
      throw new Error(
        signError?.message ?? "Could not sign attachment upload URL"
      )
    }

    tickets.push({
      attachmentId: data.id,
      path: signed.path,
      token: signed.token,
      contentType: descriptor.type || "application/octet-stream",
    })
  }

  return tickets
}

/**
 * Publish attachments whose bytes have landed. Ids are matched against the
 * issue and against rows that are still pending, so a caller can only ever
 * complete uploads it just reserved for that issue.
 */
async function completeAttachmentUploads(
  supabase: Supabase,
  issueId: string,
  attachmentIds: string[]
): Promise<Attachment[]> {
  if (attachmentIds.length === 0) {
    return []
  }

  const { data, error } = await supabase
    .from("attachments")
    .update({ upload_completed_at: new Date().toISOString() })
    .eq("issue_id", issueId)
    .is("upload_completed_at", null)
    .is("deleted_at", null)
    .in("id", attachmentIds)
    .select("id,file_name,content_type,size_bytes,storage_path,deleted_at")
    .returns<SignableAttachment[]>()

  if (error) {
    throw new Error(error.message)
  }

  // Signed here rather than left null: the composer swaps its optimistic
  // bubble for this response, so anything missing a thumbnail would drop the
  // just-sent image back to a file icon until the next refetch lands. The
  // update above is RLS-scoped to the issue every caller has already
  // ownership-checked, so these rows are the caller's to sign.
  return Promise.all((data ?? []).map(createAttachmentSigner()))
}

async function cleanupUploadedAttachments(
  supabase: Supabase,
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

async function cleanupIssueAttachments(supabase: Supabase, issueId: string) {
  const { data } = await supabase
    .from("attachments")
    .select("id,storage_path")
    .eq("issue_id", issueId)
    .is("deleted_at", null)
    .returns<Array<{ id: string; storage_path: string }>>()

  await cleanupUploadedAttachments(
    supabase,
    (data ?? []).map((attachment) => attachment.storage_path),
    (data ?? []).map((attachment) => attachment.id)
  )
}

async function cleanupFailedMessage(
  supabase: Supabase,
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
