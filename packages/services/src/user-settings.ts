import {
  agentProviderSchema,
  type AgentProvider,
} from "@gentic/validators/issues"

import { ServiceError } from "./errors"
import type { Supabase } from "./types"

export type UserSettings = {
  user_id: string
  default_agent_provider: AgentProvider
}

export const DEFAULT_AGENT_PROVIDER: AgentProvider = "claude_code"

export async function getUserSettings(
  supabase: Supabase,
  userId: string
): Promise<UserSettings> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("user_id,default_agent_provider")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return {
    user_id: userId,
    default_agent_provider: data
      ? agentProviderSchema.parse(data.default_agent_provider)
      : DEFAULT_AGENT_PROVIDER,
  }
}

export async function updateUserSettings(
  supabase: Supabase,
  userId: string,
  input: { default_agent_provider: AgentProvider }
): Promise<UserSettings> {
  const { data, error } = await supabase
    .from("user_settings")
    .upsert(
      {
        user_id: userId,
        default_agent_provider: input.default_agent_provider,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("user_id,default_agent_provider")
    .single()

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return {
    user_id: data.user_id,
    default_agent_provider: agentProviderSchema.parse(
      data.default_agent_provider
    ),
  }
}
