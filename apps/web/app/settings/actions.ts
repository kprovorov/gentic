"use server"

import { revalidatePath } from "next/cache"
import { idSchema, projectSchema } from "@gentic/validators/projects"

import * as projectsService from "@gentic/services/projects"
import * as githubIntegrationsService from "@gentic/services/github-integrations"

import { getAuthenticatedContext } from "../_lib/auth-context"
import { getCheckbox, getString } from "../_lib/form-data"

export async function createProject(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const project = projectSchema.parse({
    name: getString(formData, "name"),
    repo: getString(formData, "repo"),
    setup_script: getString(formData, "setup_script"),
    auto_respond_to_reviews: getCheckbox(formData, "auto_respond_to_reviews"),
  })

  await projectsService.createProject(supabase, userId, project)

  revalidatePath("/settings")
}

export async function updateProject(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const id = idSchema.parse(getString(formData, "id"))
  const project = projectSchema.parse({
    name: getString(formData, "name"),
    repo: getString(formData, "repo"),
    setup_script: getString(formData, "setup_script"),
    auto_respond_to_reviews: getCheckbox(formData, "auto_respond_to_reviews"),
  })

  await projectsService.updateProject(supabase, userId, id, project)

  revalidatePath("/settings")
}

export async function deleteProject(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const id = idSchema.parse(getString(formData, "id"))

  await projectsService.deleteProject(supabase, userId, id)

  revalidatePath("/settings")
}

export async function disconnectGithubIntegration() {
  const { supabase, userId } = await getAuthenticatedContext()

  await githubIntegrationsService.deleteGithubIntegration(supabase, userId)

  revalidatePath("/settings")
}
