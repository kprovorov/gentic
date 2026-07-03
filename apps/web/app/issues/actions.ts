"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient } from "@gentic/supabase/server"

const issueStatusSchema = z.enum(["draft", "todo", "in-progress", "done"])

const issueSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().optional(),
  status: issueStatusSchema,
})

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

async function getAuthenticatedSupabase() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (!data?.claims?.sub) {
    redirect("/login")
  }

  return supabase
}

export async function createIssue(formData: FormData) {
  const supabase = await getAuthenticatedSupabase()
  const issue = issueSchema.parse({
    project_id: getString(formData, "project_id"),
    title: getString(formData, "title"),
    prompt: getString(formData, "prompt") || undefined,
    status: getString(formData, "status") || "todo",
  })

  const { data, error } = await supabase
    .from("issues")
    .insert({
      ...issue,
      prompt: issue.prompt ?? null,
    })
    .select("id")
    .single()

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/home")
  redirect(`/issues/${data.id}`)
}

const updateIssueSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().optional(),
})

export async function updateIssue(formData: FormData) {
  const supabase = await getAuthenticatedSupabase()
  const { id, title, prompt } = updateIssueSchema.parse({
    id: getString(formData, "id"),
    title: getString(formData, "title"),
    prompt: getString(formData, "prompt") || undefined,
  })

  const { error } = await supabase
    .from("issues")
    .update({
      title,
      prompt: prompt ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/home")
  revalidatePath(`/issues/${id}`)
  redirect(`/issues/${id}`)
}

export async function updateIssueStatus(formData: FormData) {
  const supabase = await getAuthenticatedSupabase()
  const id = z.string().uuid().parse(getString(formData, "id"))
  const status = issueStatusSchema.parse(getString(formData, "status"))

  const { data: current, error: fetchError } = await supabase
    .from("issues")
    .select("status,title,prompt")
    .eq("id", id)
    .single<{ status: string; title: string; prompt: string | null }>()

  if (fetchError) {
    throw new Error(fetchError.message)
  }

  // Moving an issue from Draft to Todo queues an agent run: the remote
  // `@gentic/gentic` agent picks up `run_status = 'queued'` issues over
  // Supabase and drives Claude Code against a fresh clone of the repo.
  const startsRun = current.status === "draft" && status === "todo"

  const { error } = await supabase
    .from("issues")
    .update(startsRun ? { status, run_status: "queued" } : { status })
    .eq("id", id)

  if (error) {
    throw new Error(error.message)
  }

  if (startsRun) {
    const messageContent = current.prompt
      ? `${current.title}\n\n${current.prompt}`
      : current.title

    const { error: messageError } = await supabase.from("messages").insert({
      issue_id: id,
      role: "user",
      content: messageContent,
    })

    if (messageError) {
      throw new Error(messageError.message)
    }
  }

  revalidatePath("/home")
  revalidatePath(`/issues/${id}`)
}

const sendMessageSchema = z.object({
  issue_id: z.string().uuid(),
  content: z.string().trim().min(1).max(10_000),
})

export async function sendIssueMessage(formData: FormData) {
  const supabase = await getAuthenticatedSupabase()
  const { issue_id, content } = sendMessageSchema.parse({
    issue_id: getString(formData, "issue_id"),
    content: getString(formData, "content"),
  })

  const { error } = await supabase.from("messages").insert({
    issue_id,
    role: "user",
    content,
  })

  if (error) {
    throw new Error(error.message)
  }

  // A finished run has no worker polling for it anymore. Re-queue so the
  // `@gentic/gentic` agent picks this follow-up up and resumes the session.
  const { error: requeueError } = await supabase
    .from("issues")
    .update({ run_status: "queued", updated_at: new Date().toISOString() })
    .eq("id", issue_id)
    .in("run_status", ["completed", "failed", "cancelled"])

  if (requeueError) {
    throw new Error(requeueError.message)
  }

  revalidatePath(`/issues/${issue_id}`)
}
