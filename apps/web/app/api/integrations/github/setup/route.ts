import { randomBytes } from "node:crypto"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { createClient } from "@gentic/supabase/server"
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
  const supabase = await createClient()

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
