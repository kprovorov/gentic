"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { createClient } from "@gentic/supabase/server"
import { idSchema, projectSchema } from "@gentic/validators/projects"

import * as projectsService from "@gentic/services/projects"

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
    setup_script: getString(formData, "setup_script"),
  })

  await projectsService.createProject(supabase, userId, project)

  revalidatePath("/settings")
}

export async function updateProject(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedSupabase()
  const id = idSchema.parse(getString(formData, "id"))
  const project = projectSchema.parse({
    name: getString(formData, "name"),
    repo: getString(formData, "repo"),
    setup_script: getString(formData, "setup_script"),
  })

  await projectsService.updateProject(supabase, userId, id, project)

  revalidatePath("/settings")
}

export async function deleteProject(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedSupabase()
  const id = idSchema.parse(getString(formData, "id"))

  await projectsService.deleteProject(supabase, userId, id)

  revalidatePath("/settings")
}
