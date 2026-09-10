import { randomBytes } from "node:crypto"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { createServiceClient } from "@gentic/supabase/service"
import * as githubIntegrationsService from "@gentic/services/github-integrations"

export const runtime = "nodejs"

export async function GET() {
  const { userId } = await auth()

  if (!userId) {
    redirect("/login")
  }

  const appSlug = process.env.GITHUB_APP_SLUG

  if (!appSlug) {
    redirect("/settings?github=not-configured")
  }

  const state = randomBytes(32).toString("base64url")
  // Setup states are no longer writable by `authenticated` — they carry the
  // pending installation id through the callback's verification hop.
  const supabase = createServiceClient()

  await githubIntegrationsService.createGithubIntegrationState(
    supabase,
    userId,
    state
  )

  const installUrl = new URL(
    `https://github.com/apps/${appSlug}/installations/new`
  )
  installUrl.searchParams.set("state", state)

  redirect(installUrl.toString())
}
