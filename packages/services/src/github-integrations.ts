import { ServiceError } from "./errors"
import type { Supabase } from "./types"

export type GithubIntegrationStatus = "connected" | "pending"

export type GithubIntegration = {
  id: string
  user_id: string
  installation_id: string | null
  setup_action: string | null
  status: GithubIntegrationStatus
  connected_at: string | null
  created_at: string
  updated_at: string
}

export async function getGithubIntegration(
  supabase: Supabase,
  userId: string
) {
  const { data, error } = await supabase
    .from("github_integrations")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return data as GithubIntegration | null
}

export async function createGithubIntegrationState(
  supabase: Supabase,
  userId: string,
  state: string
) {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const { error } = await supabase.from("github_integration_states").insert({
    state,
    user_id: userId,
    expires_at: expiresAt,
  })

  if (error) {
    throw new ServiceError("internal", error.message)
  }
}

export async function consumeGithubIntegrationState(
  supabase: Supabase,
  userId: string,
  state: string
) {
  const { data, error } = await supabase
    .from("github_integration_states")
    .delete()
    .eq("state", state)
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString())
    .select("state")
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("validation", "Invalid or expired GitHub setup state")
  }
}

export async function upsertGithubIntegration(
  supabase: Supabase,
  userId: string,
  input: {
    installationId: string | null
    setupAction: string | null
    status: GithubIntegrationStatus
  }
) {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from("github_integrations")
    .upsert(
      {
        user_id: userId,
        installation_id: input.installationId,
        setup_action: input.setupAction,
        status: input.status,
        connected_at: input.status === "connected" ? now : null,
        updated_at: now,
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single()

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return data as GithubIntegration
}

export async function deleteGithubIntegration(
  supabase: Supabase,
  userId: string
) {
  const { error } = await supabase
    .from("github_integrations")
    .delete()
    .eq("user_id", userId)

  if (error) {
    throw new ServiceError("internal", error.message)
  }
}
