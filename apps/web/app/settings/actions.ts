"use server"

import { revalidatePath } from "next/cache"
import { agentProviderSchema } from "@gentic/validators/issues"
import { idSchema, projectSchema } from "@gentic/validators/projects"

import * as projectsService from "@gentic/services/projects"
import * as githubIntegrationsService from "@gentic/services/github-integrations"
import * as userSettingsService from "@gentic/services/user-settings"

import { getAuthenticatedContext } from "../_lib/auth-context"
import { getCheckbox, getString } from "../_lib/form-data"
import { fetchInstallationRepositories } from "@/lib/github-app"

export async function createProject(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const project = projectSchema.parse({
    name: getString(formData, "name"),
    repo: getString(formData, "repo"),
    setup_script: getString(formData, "setup_script"),
    auto_respond_to_reviews: getCheckbox(formData, "auto_respond_to_reviews"),
  })

  const githubIntegration =
    await githubIntegrationsService.getGithubIntegration(supabase, userId)

  if (
    githubIntegration?.status !== "connected" ||
    !githubIntegration.installation_id
  ) {
    throw new Error("Connect GitHub before creating a project.")
  }

  const repositories = await fetchInstallationRepositories(
    githubIntegration.installation_id
  )

  if (
    !repositories.some((repository) => repository.full_name === project.repo)
  ) {
    throw new Error("Choose a repository from the connected GitHub installation.")
  }

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

export async function updateDefaultAgent(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const defaultAgentProvider = agentProviderSchema.parse(
    getString(formData, "default_agent_provider")
  )

  await userSettingsService.updateUserSettings(supabase, userId, {
    default_agent_provider: defaultAgentProvider,
  })

  revalidatePath("/settings")
  revalidatePath("/issues/new")
}
