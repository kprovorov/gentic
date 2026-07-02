"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const taskStatusSchema = z.enum(["todo", "in-progress", "done"])

const taskSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().optional(),
  status: taskStatusSchema,
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

export async function createTask(formData: FormData) {
  const supabase = await getAuthenticatedSupabase()
  const task = taskSchema.parse({
    project_id: getString(formData, "project_id"),
    title: getString(formData, "title"),
    description: getString(formData, "description") || undefined,
    status: getString(formData, "status") || "todo",
  })

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      ...task,
      description: task.description ?? null,
    })
    .select("id")
    .single()

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/home")
  redirect(`/tasks/${data.id}`)
}

export async function updateTaskStatus(formData: FormData) {
  const supabase = await getAuthenticatedSupabase()
  const id = z.string().uuid().parse(getString(formData, "id"))
  const status = taskStatusSchema.parse(getString(formData, "status"))

  const { error } = await supabase
    .from("tasks")
    .update({ status })
    .eq("id", id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/home")
  revalidatePath(`/tasks/${id}`)
}
