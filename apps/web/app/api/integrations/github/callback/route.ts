import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { createClient } from "@gentic/supabase/server"
import * as githubIntegrationsService from "@gentic/services/github-integrations"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { userId } = await auth()

  if (!userId) {
    redirect("/login")
  }

  const url = new URL(request.url)
  const state = url.searchParams.get("state")
  const installationId = url.searchParams.get("installation_id")
  const setupAction = url.searchParams.get("setup_action")

  if (!state) {
    redirect("/settings?github=missing-state")
  }

  const supabase = await createClient()

  await githubIntegrationsService.consumeGithubIntegrationState(
    supabase,
    userId,
    state
  )

  if (setupAction === "request") {
    await githubIntegrationsService.upsertGithubIntegration(supabase, userId, {
      installationId: null,
      setupAction,
      status: "pending",
    })
    redirect("/settings?github=pending")
  }

  if (!installationId) {
    redirect("/settings?github=missing-installation")
  }

  await githubIntegrationsService.upsertGithubIntegration(supabase, userId, {
    installationId,
    setupAction,
    status: "connected",
  })

  redirect("/settings?github=connected")
}
