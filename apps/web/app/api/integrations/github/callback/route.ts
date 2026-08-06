import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { createClient } from "@gentic/supabase/server"
import { ServiceError } from "@gentic/services/errors"
import * as githubIntegrationsService from "@gentic/services/github-integrations"

export const runtime = "nodejs"

type CallbackDependencies = {
  consumeState: (userId: string, state: string) => Promise<void>
  upsertIntegration: (
    userId: string,
    input: {
      installationId: string | null
      setupAction: string | null
      status: githubIntegrationsService.GithubIntegrationStatus
    }
  ) => Promise<unknown>
}

export async function completeGithubCallback(
  request: Request,
  userId: string,
  deps: CallbackDependencies
) {
  const url = new URL(request.url)
  const state = url.searchParams.get("state")
  const installationId = url.searchParams.get("installation_id")
  const setupAction = url.searchParams.get("setup_action")

  if (!state) {
    return "/settings?github=missing-state"
  }

  await deps.consumeState(userId, state)

  if (setupAction === "request") {
    await deps.upsertIntegration(userId, {
      installationId: null,
      setupAction,
      status: "pending",
    })
    return "/settings?github=pending"
  }

  if (!installationId) {
    return "/settings?github=missing-installation"
  }

  try {
    await deps.upsertIntegration(userId, {
      installationId,
      setupAction,
      status: "connected",
    })
  } catch (error) {
    if (error instanceof ServiceError && error.code === "conflict") {
      return "/settings?github=installation-conflict"
    }
    throw error
  }

  return "/settings?github=connected"
}

export async function GET(request: Request) {
  const { userId } = await auth()

  if (!userId) {
    redirect("/login")
  }

  const supabase = await createClient()
  const destination = await completeGithubCallback(request, userId, {
    consumeState: (ownerId, state) =>
      githubIntegrationsService.consumeGithubIntegrationState(
        supabase,
        ownerId,
        state
      ),
    upsertIntegration: (ownerId, input) =>
      githubIntegrationsService.upsertGithubIntegration(
        supabase,
        ownerId,
        input
      ),
  })

  redirect(destination)
}
