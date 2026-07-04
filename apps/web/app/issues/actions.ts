"use server"

import { randomUUID } from "node:crypto"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { auth } from "@clerk/nextjs/server"

import { createClient } from "@gentic/supabase/server"
import {
  createIssueSchema,
  issueStatusSchema,
  sendIssueMessageSchema,
  updateIssueSchema,
} from "@gentic/validators/issues"

import * as issuesService from "@/lib/services/issues"

const ATTACHMENTS_BUCKET = "attachments"
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file"
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file"
}

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

async function getAuthenticatedContext() {
  const { userId } = await auth()

  if (!userId) {
    redirect("/login")
  }

  return { supabase: await createClient(), userId }
}

export async function createIssue(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const issue = createIssueSchema.parse({
    project_id: getString(formData, "project_id"),
    title: getString(formData, "title"),
    prompt: getString(formData, "prompt") || undefined,
    status: getString(formData, "status") || "draft",
  })

  const created = await issuesService.createIssue(supabase, userId, issue)

  revalidatePath("/home")
  redirect(`/issues/${created.id}`)
}

export async function updateIssue(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { id, title, prompt } = updateIssueSchema.parse({
    id: getString(formData, "id"),
    title: getString(formData, "title"),
    prompt: getString(formData, "prompt") || undefined,
  })

  await issuesService.updateIssue(supabase, userId, id, { id, title, prompt })

  revalidatePath("/home")
  revalidatePath(`/issues/${id}`)
  redirect(`/issues/${id}`)
}

export async function deleteIssue(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const id = z.string().uuid().parse(getString(formData, "id"))

  await issuesService.deleteIssue(supabase, userId, id)

  revalidatePath("/home")
  redirect("/home")
}

export async function updateIssueStatus(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const id = z.string().uuid().parse(getString(formData, "id"))
  const status = issueStatusSchema.parse(getString(formData, "status"))

  await issuesService.updateIssueStatus(supabase, userId, id, status)

  revalidatePath("/home")
  revalidatePath(`/issues/${id}`)
}

export async function sendIssueMessage(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const { issue_id, content } = sendIssueMessageSchema.parse({
    issue_id: getString(formData, "issue_id"),
    content: getString(formData, "content"),
  })

  await issuesService.sendIssueMessage(supabase, userId, issue_id, content)

  revalidatePath(`/issues/${issue_id}`)
}

export async function uploadAttachments(formData: FormData) {
  const { supabase } = await getAuthenticatedContext()
  const issueId = z.string().uuid().parse(getString(formData, "issue_id"))
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0)

  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`"${file.name}" is larger than 25MB`)
    }

    const storagePath = `${issueId}/${randomUUID()}-${sanitizeFileName(file.name)}`

    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
      })

    if (uploadError) {
      throw new Error(uploadError.message)
    }

    const { error: insertError } = await supabase.from("attachments").insert({
      issue_id: issueId,
      file_name: file.name,
      content_type: file.type || null,
      size_bytes: file.size,
      storage_path: storagePath,
    })

    if (insertError) {
      throw new Error(insertError.message)
    }
  }

  revalidatePath(`/issues/${issueId}`)
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
    .select("storage_path")
    .eq("id", id)
    .single<{ storage_path: string }>()

  if (fetchError) {
    throw new Error(fetchError.message)
  }

  const { error: removeError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .remove([attachment.storage_path])

  if (removeError) {
    throw new Error(removeError.message)
  }

  const { error } = await supabase
    .from("attachments")
    .delete()
    .eq("id", id)
    .eq("issue_id", issue_id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath(`/issues/${issue_id}`)
}
