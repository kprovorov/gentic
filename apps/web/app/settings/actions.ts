"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { auth } from "@clerk/nextjs/server"

import { createClient } from "@gentic/supabase/server"

const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  repo: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/,
      "Use the format user/repo"
    ),
})

const idSchema = z.string().uuid()

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

async function getAuthenticatedSupabase() {
  const { userId } = await auth()

  if (!userId) {
    redirect("/login")
  }

  const supabase = await createClient()

  return { supabase, userId }
}

export async function createProject(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedSupabase()
  const project = projectSchema.parse({
    name: getString(formData, "name"),
    repo: getString(formData, "repo"),
  })

  const { error } = await supabase.from("projects").insert({
    ...project,
    user_id: userId,
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/settings")
}

export async function updateProject(formData: FormData) {
  const { supabase } = await getAuthenticatedSupabase()
  const id = idSchema.parse(getString(formData, "id"))
  const project = projectSchema.parse({
    name: getString(formData, "name"),
    repo: getString(formData, "repo"),
  })

  const { error } = await supabase
    .from("projects")
    .update({
      ...project,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/settings")
}

export async function deleteProject(formData: FormData) {
  const { supabase } = await getAuthenticatedSupabase()
  const id = idSchema.parse(getString(formData, "id"))

  const { error } = await supabase.from("projects").delete().eq("id", id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/settings")
}
