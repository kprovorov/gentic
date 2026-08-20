"use server"

import { revalidatePath } from "next/cache"
import { agentProviderSchema } from "@gentic/validators/issues"
import { createLabelSchema, updateLabelSchema } from "@gentic/validators/labels"
import { idSchema, projectSchema } from "@gentic/validators/projects"

import * as labelsService from "@gentic/services/labels"
import * as projectsService from "@gentic/services/projects"
import * as githubIntegrationsService from "@gentic/services/github-integrations"
import * as userSettingsService from "@gentic/services/user-settings"

import {
  getAuthenticatedContext,
  getAuthenticatedServiceContext,
} from "../_lib/auth-context"
import { getCheckbox, getString } from "../_lib/form-data"
import { fetchInstallationRepositories } from "@/lib/github-app"

export async function createProject(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const project = projectSchema.parse({
    name: getString(formData, "name"),
    repo: getString(formData, "repo"),
    setup_script: getString(formData, "setup_script"),
    auto_respond_to_reviews: getCheckbox(formData, "auto_respond_to_reviews"),
    automatic_review_enabled: getCheckbox(formData, "automatic_review_enabled"),
    automatic_review_provider:
      getString(formData, "automatic_review_provider") || null,
    automatic_review_model:
      getString(formData, "automatic_review_model") || null,
    automatic_review_instructions: getString(
      formData,
      "automatic_review_instructions"
    ),
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
    throw new Error(
      "Choose a repository from the connected GitHub installation."
    )
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
    automatic_review_enabled: getCheckbox(formData, "automatic_review_enabled"),
    automatic_review_provider:
      getString(formData, "automatic_review_provider") || null,
    automatic_review_model:
      getString(formData, "automatic_review_model") || null,
    automatic_review_instructions: getString(
      formData,
      "automatic_review_instructions"
    ),
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

export async function createLabel(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const rawColor = getString(formData, "color")
  const label = createLabelSchema.parse({
    name: getString(formData, "name"),
    ...(rawColor ? { color: rawColor } : {}),
  })

  const created = await labelsService.createLabel(supabase, userId, label)

  revalidatePath("/settings/labels")
  // Restoring an archived label revives its historical timeline appearances
  // (dropping the archived gray/strikethrough styling), so the issue views are
  // stale too — a plain new label never touches them.
  if (created.restored) {
    revalidatePath("/issues")
  }

  return created
}

export async function updateLabel(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext()
  const rawName = getString(formData, "name")
  const rawColor = getString(formData, "color")
  const label = updateLabelSchema.parse({
    id: getString(formData, "id"),
    ...(rawName ? { name: rawName } : {}),
    ...(rawColor ? { color: rawColor } : {}),
  })

  await labelsService.updateLabel(supabase, userId, label)

  revalidatePath("/settings/labels")
}

// Uses the service-role client because archiving calls the `archive_label`
// SECURITY DEFINER RPC (granted to service_role only, like the worker
// lifecycle RPCs), which atomically marks the label archived, removes
// every assignment, and records one grouped removal event per affected
// issue — see 20260805130000_add_archive_label_rpc.sql.
export async function archiveLabel(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedServiceContext()
  const id = idSchema.parse(getString(formData, "id"))

  const result = await labelsService.archiveLabel(supabase, userId, id)

  revalidatePath("/settings/labels")
  // Unlike rename/recolor, archiving also strips the label off every issue
  // that carried it, so the issue list's chips and filters are stale too.
  revalidatePath("/issues")

  return result
}
